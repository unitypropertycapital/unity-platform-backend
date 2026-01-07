/**
 * Comparable Fetcher
 * Fetches comparables from data sources with radius expansion logic
 */

import { config } from '../../utils/config';
import { logger } from '../../utils/logger';
import { getSoldPrices } from '../../services/propertyData';
import { fromPropertyData, processComparables } from './normalizer';
import { filterWithFallback, applyBasicFilters, filterByMarketSegment } from './filter';
import { isWithinRadius } from './distance';
import { enrichWithFloorAreaTiered, type EnrichmentResult } from './enricher';
import type {
  RawComparable,
  NormalizedComparable,
  RejectedComparable,
  ComparablesResult,
  ComparableFetchParams,
  ComparableFilterConfig,
  RadiusAttempt,
} from '../../types/comparable';

/**
 * Fetch raw comparables from PropertyData (which includes Land Registry data)
 */
async function fetchFromPropertyData(
  postcode: string,
  maxAgeMonths: number
): Promise<RawComparable[]> {
  const result = await getSoldPrices(postcode, maxAgeMonths);
  
  if (!result.success) {
    logger.error(`PropertyData fetch failed: ${result.error}`);
    return [];
  }
  
  if (!Array.isArray(result.sales)) {
    return [];
  }
  
  // Filter out any invalid entries and map to RawComparable
  return result.sales
    .filter((sale) => sale && sale.price && sale.address)
    .map(fromPropertyData);
}

/**
 * Filter comparables by distance from subject property
 */
function filterByRadius(
  comps: NormalizedComparable[],
  subjectLat: number,
  subjectLon: number,
  radiusMiles: number
): NormalizedComparable[] {
  return comps.filter((comp) =>
    isWithinRadius(subjectLat, subjectLon, comp.latitude, comp.longitude, radiusMiles)
  );
}

/**
 * Fetch comparables with radius expansion
 * Starts at smallest radius and expands if not enough comps found
 * 
 * OPTIMIZED FLOW (with floor area enrichment and market segmentation):
 * 1. Fetch raw comps from PropertyData
 * 2. Normalize all comps (includes ex-LA classification)
 * 3. Apply basic filters to ALL comps (type + recency)
 * 4. Enrich ALL filtered comps with floor area ONCE
 * 5. Filter by market segment (ex-LA vs private)
 * 6. For each radius: filter by distance + apply size/outlier filters
 */
export async function fetchComparablesWithExpansion(
  params: ComparableFetchParams
): Promise<ComparablesResult> {
  const { postcode, latitude, longitude, propertyType, floorAreaSqm, subjectIsExLA } = params;
  const { radiusSteps, minComps, maxRecencyMonths, sizeTolerance, outlierIqrMultiplier, maxAgeMonths } =
    config.comparables;
  
  // Fetch all raw comparables once
  const rawComps = await fetchFromPropertyData(postcode, maxAgeMonths);
  
  // Track radius attempts for debug output
  const radiusAttempts: RadiusAttempt[] = [];
  
  if (rawComps.length === 0) {
    logger.warn(`🔎 ${postcode}: ❌ No sales data found → DESK REVIEW`);
    return {
      radiusUsed: radiusSteps[radiusSteps.length - 1],
      radiusAttempts: radiusSteps.map(r => ({ radius: r, rawComps: 0, afterFilters: 0 })),
      totalFound: 0,
      totalKept: 0,
      totalRejected: 0,
      kept: [],
      rejected: [],
      stats: {
        count: 0,
        meanPricePerSqm: null,
        medianPricePerSqm: null,
        minPricePerSqm: null,
        maxPricePerSqm: null,
        stdDevPricePerSqm: null,
      },
      deskReview: true,
      deskReviewReason: 'No comparable sales data found for this postcode',
    };
  }
  
  // Normalize all comparables (adds distance, age, etc.)
  const allNormalized = processComparables(rawComps, latitude, longitude);
  logger.info(`📊 ${postcode}: ${allNormalized.length} sales loaded (${propertyType})`);
  
  // Apply basic filters (type + recency) to ALL comps ONCE
  const basicResult = applyBasicFilters(allNormalized, propertyType, maxRecencyMonths);
  logger.info(`📋 Basic filters: ${basicResult.passed.length}/${allNormalized.length} passed (type + recency)`);
  
  // Enrich filtered comps with floor area using TIERED approach
  // Tier 1: Subject postcode only (1 call) - sufficient for 80-90% of cases
  // Tier 2: Additional postcodes if needed (up to 4 total calls)
  let allEnriched: NormalizedComparable[] = [];
  let enrichmentResult: EnrichmentResult | null = null;
  
  if (basicResult.passed.length > 0) {
    enrichmentResult = await enrichWithFloorAreaTiered(basicResult.passed, postcode);
    allEnriched = enrichmentResult.comps;
    
    logger.info(`📊 Enrichment: Tier ${enrichmentResult.tier}, ${enrichmentResult.apiCallsMade} API calls, ${enrichmentResult.compsWithFloorArea}/${basicResult.passed.length} comps with floor area`);
  }
  
  // Apply market segment filtering (ex-LA vs private)
  // This ensures base £/sqm calculations use segment-matched comparables
  const marketSegmentResult = filterByMarketSegment(
    allEnriched,
    subjectIsExLA,
    propertyType,
    minComps
  );
  
  // Use segment-filtered comps for all subsequent processing
  allEnriched = marketSegmentResult.passed;
  
  // Combine rejections from basic and market segment filters
  const preFilterRejections = [...basicResult.rejected, ...marketSegmentResult.rejected];
  
  // Filter config for size and outlier filters
  const filterConfig: ComparableFilterConfig = {
    propertyType,
    floorAreaSqm,
    maxRecencyMonths,
    sizeTolerance,
    outlierIqrMultiplier,
    minComps,
  };
  
  // Try each radius step
  logger.info(`🔎 Starting radius expansion for ${postcode} (need ${minComps} comps)`);
  
  for (const radius of radiusSteps) {
    // Filter enriched comps by distance
    const withinRadius = filterByRadius(allEnriched, latitude, longitude, radius);
    
    // Count raw comps at this radius (for debug output)
    const rawWithinRadius = filterByRadius(allNormalized, latitude, longitude, radius);
    
    // Apply full filters (floor area, size, outlier) to enriched comps
    const filterResult = filterWithFallback(withinRadius, filterConfig);
    
    // Record this attempt
    radiusAttempts.push({
      radius,
      rawComps: rawWithinRadius.length,
      afterFilters: filterResult.kept.length,
    });
    
    logger.info(`   🔄 ${radius} mi → ${rawWithinRadius.length} raw → ${withinRadius.length} enriched → ${filterResult.kept.length} kept`);
    
    // Check if we have enough comps
    if (filterResult.kept.length >= minComps) {
      logger.info(`   ✅ SUCCESS at ${radius} mi!`);
      
      // Sort kept comps by distance (closest first)
      const sortedKept = [...filterResult.kept].sort(
        (a, b) => a.distanceMiles - b.distanceMiles
      );
      
      // Combine rejections: pre-filter rejections (basic + market segment) within radius + full filter rejections
      const preFilterRejectedWithinRadius = preFilterRejections.filter(r =>
        isWithinRadius(latitude, longitude, r.comp.latitude, r.comp.longitude, radius)
      );
      const totalRejected = [...preFilterRejectedWithinRadius, ...filterResult.rejected];
      
      return {
        radiusUsed: radius,
        radiusAttempts,
        totalFound: rawWithinRadius.length,
        totalKept: filterResult.kept.length,
        totalRejected: totalRejected.length,
        kept: sortedKept,
        rejected: totalRejected,
        stats: filterResult.stats,
        deskReview: false,
        deskReviewReason: null,
        enrichmentStats: enrichmentResult ? {
          tier: enrichmentResult.tier,
          apiCallsMade: enrichmentResult.apiCallsMade,
          compsWithFloorArea: enrichmentResult.compsWithFloorArea,
        } : undefined,
      };
    }
  }
  
  // Used max radius but still not enough comps
  const maxRadius = radiusSteps[radiusSteps.length - 1];
  const withinMaxRadius = filterByRadius(allEnriched, latitude, longitude, maxRadius);
  const rawWithinMaxRadius = filterByRadius(allNormalized, latitude, longitude, maxRadius);
  const finalResult = filterWithFallback(withinMaxRadius, filterConfig);
  
  // Combine all rejections at max radius
  const preFilterRejectedWithinMax = preFilterRejections.filter(r =>
    isWithinRadius(latitude, longitude, r.comp.latitude, r.comp.longitude, maxRadius)
  );
  const totalRejected = [...preFilterRejectedWithinMax, ...finalResult.rejected];
  
  // Sort kept comps by distance
  const sortedKept = [...finalResult.kept].sort(
    (a, b) => a.distanceMiles - b.distanceMiles
  );
  
  const deskReviewReason =
    finalResult.kept.length === 0
      ? `No valid comparables found within ${maxRadius} mile radius`
      : `Only ${finalResult.kept.length} valid comparable(s) found within ${maxRadius} mile radius (minimum ${minComps} required)`;
  
  logger.warn(`   ❌ Max radius ${maxRadius} mi → ${finalResult.kept.length} comps (need ${minComps}) → DESK REVIEW`);
  
  return {
    radiusUsed: maxRadius,
    radiusAttempts,
    totalFound: rawWithinMaxRadius.length,
    totalKept: finalResult.kept.length,
    totalRejected: totalRejected.length,
    kept: sortedKept,
    rejected: totalRejected,
    stats: finalResult.stats,
    deskReview: true,
    deskReviewReason,
    enrichmentStats: enrichmentResult ? {
      tier: enrichmentResult.tier,
      apiCallsMade: enrichmentResult.apiCallsMade,
      compsWithFloorArea: enrichmentResult.compsWithFloorArea,
    } : undefined,
  };
}
