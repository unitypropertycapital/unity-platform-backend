/**
 * Comparables Engine
 * Main orchestrator for fetching, normalizing, and filtering comparable sales
 */

import { logger } from '../../utils/logger';
import { fetchComparablesWithExpansion } from './fetcher';
import type { ComparablesResult, ComparableFetchParams } from '../../types/comparable';

// Re-export types for consumers
export type {
  RawComparable,
  NormalizedComparable,
  RejectedComparable,
  ComparablesResult,
  ComparableStats,
  ComparableFetchParams,
  RadiusAttempt,
} from '../../types/comparable';

// Re-export utilities
export { calculateDistanceMiles, isWithinRadius } from './distance';
export { normalizePropertyType, calculateAgeMonths } from './normalizer';

/**
 * Fetch and filter comparables for a subject property
 * 
 * This is the main entry point for the comparables engine.
 * It handles:
 * - Fetching from PropertyData (which includes Land Registry data)
 * - Radius expansion (0.25 → 0.5 → 0.75 → 1.0 miles)
 * - Normalization and deduplication
 * - Filtering by property type, recency, size, and outliers
 * - Desk review flagging when insufficient comps
 * 
 * @param params - Subject property parameters
 * @returns Comparables result with kept/rejected comps and stats
 */
export async function fetchComparables(
  params: ComparableFetchParams
): Promise<ComparablesResult> {
  logger.info('Fetching comparables for subject property', {
    postcode: params.postcode,
    propertyType: params.propertyType,
    floorAreaSqm: params.floorAreaSqm,
    coordinates: { lat: params.latitude, lon: params.longitude },
  });
  
  const startTime = Date.now();
  
  try {
    const result = await fetchComparablesWithExpansion(params);
    
    const duration = Date.now() - startTime;
    
    logger.info('Comparables fetch complete', {
      duration: `${duration}ms`,
      radiusUsed: result.radiusUsed,
      totalKept: result.totalKept,
      totalRejected: result.totalRejected,
      deskReview: result.deskReview,
    });
    
    return result;
  } catch (error) {
    logger.error('Comparables fetch failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      postcode: params.postcode,
    });
    
    // Return empty result with desk review flag
    return {
      radiusUsed: 1.0,
      radiusAttempts: [], // No attempts when error occurs
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
      deskReviewReason: `Error fetching comparables: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Format comparables result for API response
 * Converts internal structure to clean API response format
 */
export function formatComparablesResponse(result: ComparablesResult): Record<string, unknown> {
  return {
    radiusUsed: result.radiusUsed,
    // MAT-2.1: Debug output showing comp count at each radius step
    radiusAttempts: result.radiusAttempts,
    totalFound: result.totalFound,
    totalKept: result.totalKept,
    totalRejected: result.totalRejected,
    deskReview: result.deskReview,
    deskReviewReason: result.deskReviewReason,
    
    kept: result.kept.map((comp) => ({
      address: comp.address,
      postcode: comp.postcode,
      salePrice: comp.salePrice,
      saleDate: comp.saleDate,
      propertyType: comp.propertyType,
      floorAreaSqm: comp.floorAreaSqm,
      distanceMiles: comp.distanceMiles,
      pricePerSqm: comp.pricePerSqm,
      pricePerSqft: comp.pricePerSqft,
      ageMonths: comp.ageMonths,
      source: comp.source,
    })),
    
    rejected: result.rejected.map((item) => ({
      address: item.comp.address,
      postcode: item.comp.postcode,
      salePrice: item.comp.salePrice,
      saleDate: item.comp.saleDate,
      reason: item.reason,
      details: item.details,
    })),
    
    stats: result.stats,
  };
}

