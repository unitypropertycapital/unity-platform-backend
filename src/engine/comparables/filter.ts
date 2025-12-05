/**
 * Comparable Filter Module
 * Filters comparables by property type, recency, size, and outliers
 */

import { config } from '../../utils/config';
import { logger } from '../../utils/logger';
import type {
  NormalizedComparable,
  RejectedComparable,
  RejectionReason,
  ComparableStats,
  ComparableFilterConfig,
} from '../../types/comparable';

/**
 * Filter result containing kept and rejected comps
 */
export interface FilterResult {
  kept: NormalizedComparable[];
  rejected: RejectedComparable[];
  stats: ComparableStats;
}

/**
 * Check if property types are compatible
 * Houses include: detached, semi-detached, terraced, house
 * Flats include: flat, apartment, maisonette
 */
function isPropertyTypeMatch(subjectType: string, compType: string): boolean {
  const subjectNorm = subjectType.toLowerCase();
  const compNorm = compType.toLowerCase();
  
  // Exact match
  if (subjectNorm === compNorm) {
    return true;
  }
  
  // House types are compatible with each other
  const houseTypes = ['house', 'detached', 'semi-detached', 'terraced'];
  if (houseTypes.includes(subjectNorm) && houseTypes.includes(compNorm)) {
    return true;
  }
  
  // Flat types are compatible with each other
  const flatTypes = ['flat', 'apartment', 'maisonette'];
  if (flatTypes.includes(subjectNorm) && flatTypes.includes(compNorm)) {
    return true;
  }
  
  // Bungalows only match bungalows
  if (subjectNorm === 'bungalow' && compNorm === 'bungalow') {
    return true;
  }
  
  return false;
}

/**
 * Check if floor area is within tolerance
 */
function isSizeWithinTolerance(
  subjectSqm: number | null,
  compSqm: number | null,
  tolerance: number
): boolean {
  // If either is missing, we can't filter by size - allow through
  if (!subjectSqm || !compSqm) {
    return true;
  }
  
  const lowerBound = subjectSqm * (1 - tolerance);
  const upperBound = subjectSqm * (1 + tolerance);
  
  return compSqm >= lowerBound && compSqm <= upperBound;
}

/**
 * Calculate IQR bounds for outlier detection
 */
function calculateIQRBounds(values: number[], multiplier: number): { lower: number; upper: number } {
  if (values.length < 4) {
    // Not enough data for IQR - use extreme bounds
    return { lower: -Infinity, upper: Infinity };
  }
  
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  
  const q1Index = Math.floor(n * 0.25);
  const q3Index = Math.floor(n * 0.75);
  
  const q1 = sorted[q1Index];
  const q3 = sorted[q3Index];
  const iqr = q3 - q1;
  
  return {
    lower: q1 - multiplier * iqr,
    upper: q3 + multiplier * iqr,
  };
}

/**
 * Calculate statistics for kept comparables
 */
function calculateStats(comps: NormalizedComparable[]): ComparableStats {
  const pricesPerSqm = comps
    .map((c) => c.pricePerSqm)
    .filter((p): p is number => p !== null);
  
  if (pricesPerSqm.length === 0) {
    return {
      count: comps.length,
      meanPricePerSqm: null,
      medianPricePerSqm: null,
      minPricePerSqm: null,
      maxPricePerSqm: null,
      stdDevPricePerSqm: null,
    };
  }
  
  const sorted = [...pricesPerSqm].sort((a, b) => a - b);
  const sum = pricesPerSqm.reduce((acc, val) => acc + val, 0);
  const mean = sum / pricesPerSqm.length;
  
  // Median
  const midIndex = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[midIndex - 1] + sorted[midIndex]) / 2
      : sorted[midIndex];
  
  // Standard deviation
  const squaredDiffs = pricesPerSqm.map((val) => Math.pow(val - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((acc, val) => acc + val, 0) / pricesPerSqm.length;
  const stdDev = Math.sqrt(avgSquaredDiff);
  
  return {
    count: comps.length,
    meanPricePerSqm: Math.round(mean),
    medianPricePerSqm: Math.round(median),
    minPricePerSqm: Math.round(sorted[0]),
    maxPricePerSqm: Math.round(sorted[sorted.length - 1]),
    stdDevPricePerSqm: Math.round(stdDev),
  };
}

/**
 * Reject a comparable with reason
 */
function reject(
  comp: NormalizedComparable,
  reason: RejectionReason,
  details: string
): RejectedComparable {
  return { comp, reason, details };
}

/**
 * Filter comparables based on configuration
 */
export function filterComparables(
  comps: NormalizedComparable[],
  filterConfig: ComparableFilterConfig
): FilterResult {
  const kept: NormalizedComparable[] = [];
  const rejected: RejectedComparable[] = [];
  
  
  // Step 1: Apply basic filters (type, recency, size)
  for (const comp of comps) {
    // Validate required data
    if (!comp.latitude || !comp.longitude || !comp.salePrice) {
      rejected.push(reject(comp, 'invalid_data', 'Missing required fields (coordinates or price)'));
      continue;
    }
    
    // Property type filter
    if (!isPropertyTypeMatch(filterConfig.propertyType, comp.propertyType)) {
      rejected.push(
        reject(
          comp,
          'wrong_property_type',
          `Subject is ${filterConfig.propertyType}, comp is ${comp.propertyType}`
        )
      );
      continue;
    }
    
    // Recency filter
    if (comp.ageMonths > filterConfig.maxRecencyMonths) {
      rejected.push(
        reject(
          comp,
          'too_old',
          `Sale date ${comp.ageMonths} months ago, max allowed is ${filterConfig.maxRecencyMonths} months`
        )
      );
      continue;
    }
    
    // Size similarity filter
    if (!isSizeWithinTolerance(filterConfig.floorAreaSqm, comp.floorAreaSqm, filterConfig.sizeTolerance)) {
      const tolerance = Math.round(filterConfig.sizeTolerance * 100);
      rejected.push(
        reject(
          comp,
          'size_mismatch',
          `Floor area ${comp.floorAreaSqm} sqm, subject is ${filterConfig.floorAreaSqm} sqm (±${tolerance}% allowed)`
        )
      );
      continue;
    }
    
    kept.push(comp);
  }
  
  // Step 2: Apply IQR outlier detection on kept comps
  const pricesPerSqm = kept
    .map((c) => c.pricePerSqm)
    .filter((p): p is number => p !== null);
  
  if (pricesPerSqm.length >= 4) {
    const bounds = calculateIQRBounds(pricesPerSqm, filterConfig.outlierIqrMultiplier);
    const mean = pricesPerSqm.reduce((a, b) => a + b, 0) / pricesPerSqm.length;
    
    const finalKept: NormalizedComparable[] = [];
    
    for (const comp of kept) {
      if (comp.pricePerSqm !== null) {
        if (comp.pricePerSqm < bounds.lower) {
          rejected.push(
            reject(
              comp,
              'outlier_low',
              `Price £${comp.pricePerSqm}/sqm is below IQR lower bound (£${Math.round(bounds.lower)}/sqm), mean is £${Math.round(mean)}/sqm`
            )
          );
          continue;
        }
        
        if (comp.pricePerSqm > bounds.upper) {
          rejected.push(
            reject(
              comp,
              'outlier_high',
              `Price £${comp.pricePerSqm}/sqm is above IQR upper bound (£${Math.round(bounds.upper)}/sqm), mean is £${Math.round(mean)}/sqm`
            )
          );
          continue;
        }
      }
      
      finalKept.push(comp);
    }
    
    
    return {
      kept: finalKept,
      rejected,
      stats: calculateStats(finalKept),
    };
  }
  
  // Not enough data for outlier detection
  return {
    kept,
    rejected,
    stats: calculateStats(kept),
  };
}

/**
 * Apply fallback filters with relaxed recency
 * Used when primary filter returns too few comps
 */
export function filterWithFallback(
  comps: NormalizedComparable[],
  filterConfig: ComparableFilterConfig
): FilterResult {
  // First try with primary settings
  const primaryResult = filterComparables(comps, filterConfig);
  
  if (primaryResult.kept.length >= filterConfig.minComps) {
    return primaryResult;
  }
  
  logger.info(`Filter fallback: ${primaryResult.kept.length}/${filterConfig.minComps} comps, trying ${config.comparables.fallbackRecencyMonths}mo recency`);
  
  // Try with extended recency
  const fallbackConfig: ComparableFilterConfig = {
    ...filterConfig,
    maxRecencyMonths: config.comparables.fallbackRecencyMonths,
  };
  
  return filterComparables(comps, fallbackConfig);
}


