/**
 * Comparable Fetcher
 * Fetches comparables from data sources with radius expansion logic
 */

import { config } from '../../utils/config';
import { logger } from '../../utils/logger';
import { getSoldPrices } from '../../services/propertyData';
import { fromPropertyData, processComparables } from './normalizer';
import { filterWithFallback } from './filter';
import { isWithinRadius } from './distance';
import type {
  RawComparable,
  NormalizedComparable,
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
 */
export async function fetchComparablesWithExpansion(
  params: ComparableFetchParams
): Promise<ComparablesResult> {
  const { postcode, latitude, longitude, propertyType, floorAreaSqm } = params;
  const { radiusSteps, minComps, maxRecencyMonths, sizeTolerance, outlierIqrMultiplier, maxAgeMonths } =
    config.comparables;
  
  // Fetch all raw comparables once (we'll filter by radius in memory)
  const rawComps = await fetchFromPropertyData(postcode, maxAgeMonths);
  
  // Track radius attempts for MAT-2.1 debug output
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
  
  // Filter config for this property
  const filterConfig: ComparableFilterConfig = {
    propertyType,
    floorAreaSqm,
    maxRecencyMonths,
    sizeTolerance,
    outlierIqrMultiplier,
    minComps,
  };
  
  // Try each radius step (MAT-2.1: track attempts with emoji logging)
  logger.info(`🔎 Starting radius expansion for ${postcode} (need ${minComps} comps)`);
  
  for (const radius of radiusSteps) {
    // Filter by distance
    const withinRadius = filterByRadius(allNormalized, latitude, longitude, radius);
    
    // Apply all filters to get count
    const filterResult = filterWithFallback(withinRadius, filterConfig);
    
    // Record this attempt for debug output
    radiusAttempts.push({
      radius,
      rawComps: withinRadius.length,
      afterFilters: filterResult.kept.length,
    });
    
    // Check if we have enough comps
    if (filterResult.kept.length >= minComps) {
      // Log success
      logger.info(`   ✅ ${radius} mi → ${withinRadius.length} found → ${filterResult.kept.length} kept (SUCCESS)`);
      
      // Sort kept comps by distance (closest first)
      const sortedKept = [...filterResult.kept].sort(
        (a, b) => a.distanceMiles - b.distanceMiles
      );
      
      return {
        radiusUsed: radius,
        radiusAttempts,
        totalFound: withinRadius.length,
        totalKept: filterResult.kept.length,
        totalRejected: filterResult.rejected.length,
        kept: sortedKept,
        rejected: filterResult.rejected,
        stats: filterResult.stats,
        deskReview: false,
        deskReviewReason: null,
      };
    } else {
      // Log expansion needed
      logger.info(`   🔄 ${radius} mi → ${withinRadius.length} found → ${filterResult.kept.length} kept (expanding...)`);
    }
  }
  
  // Used max radius but still not enough comps
  const maxRadius = radiusSteps[radiusSteps.length - 1];
  const lastAttempt = radiusAttempts[radiusAttempts.length - 1];
  
  // Get the final filter result from the last attempt
  const withinMaxRadius = filterByRadius(allNormalized, latitude, longitude, maxRadius);
  const finalResult = filterWithFallback(withinMaxRadius, filterConfig);
  
  // Sort kept comps by distance
  const sortedKept = [...finalResult.kept].sort(
    (a, b) => a.distanceMiles - b.distanceMiles
  );
  
  const deskReviewReason =
    finalResult.kept.length === 0
      ? `No valid comparables found within ${maxRadius} mile radius`
      : `Only ${finalResult.kept.length} valid comparable(s) found within ${maxRadius} mile radius (minimum ${minComps} required)`;
  
  // Log desk review needed
  logger.warn(`   ❌ Max radius ${maxRadius} mi reached → only ${finalResult.kept.length} comps (need ${minComps}) → DESK REVIEW`);
  
  return {
    radiusUsed: maxRadius,
    radiusAttempts,
    totalFound: withinMaxRadius.length,
    totalKept: finalResult.kept.length,
    totalRejected: finalResult.rejected.length,
    kept: sortedKept,
    rejected: finalResult.rejected,
    stats: finalResult.stats,
    deskReview: true,
    deskReviewReason,
  };
}

