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
 * Note: compSqm is guaranteed to be non-null at this point (enforced by floor area filter)
 */
function isSizeWithinTolerance(
  subjectSqm: number | null,
  compSqm: number,
  tolerance: number
): boolean {
  // If subject has no floor area (no EPC), we can't filter by size - allow through
  if (!subjectSqm) {
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
 * Pre-filter result for basic filters (property type + recency)
 * Used before floor area enrichment to reduce API calls
 */
export interface PreFilterResult {
  passed: NormalizedComparable[];
  rejected: RejectedComparable[];
}

/**
 * Apply basic filters BEFORE floor area enrichment
 * This reduces the number of comps we need to enrich with floor area data
 * 
 * Filters: property type, recency, valid coordinates
 */
export function applyBasicFilters(
  comps: NormalizedComparable[],
  propertyType: string,
  maxRecencyMonths: number
): PreFilterResult {
  const passed: NormalizedComparable[] = [];
  const rejected: RejectedComparable[] = [];
  
  for (const comp of comps) {
    // Validate required data
    if (!comp.latitude || !comp.longitude || !comp.salePrice) {
      rejected.push(reject(comp, 'invalid_data', 'Missing required fields (coordinates or price)'));
      continue;
    }
    
    // Property type filter
    if (!isPropertyTypeMatch(propertyType, comp.propertyType)) {
      rejected.push(
        reject(
          comp,
          'wrong_property_type',
          `Subject is ${propertyType}, comp is ${comp.propertyType}`
        )
      );
      continue;
    }
    
    // Recency filter
    if (comp.ageMonths > maxRecencyMonths) {
      rejected.push(
        reject(
          comp,
          'too_old',
          `Sale date ${comp.ageMonths} months ago, max allowed is ${maxRecencyMonths} months`
        )
      );
      continue;
    }
    
    passed.push(comp);
  }
  
  return { passed, rejected };
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
  
  
  // Step 1: Apply basic filters (type, recency, floor area, size)
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
    
    // Floor area filter - REQUIRED for £/sqm calculation
    // Comps without floor area cannot be used for valuation
    if (comp.floorAreaSqm === null || comp.floorAreaSqm <= 0) {
      rejected.push(
        reject(
          comp,
          'no_floor_area',
          'Missing floor area - cannot calculate £/sqm for valuation'
        )
      );
      continue;
    }
    
    // At this point, comp has valid floor area, so pricePerSqm should be valid
    if (comp.pricePerSqm === null) {
      rejected.push(
        reject(
          comp,
          'no_floor_area',
          'Could not calculate £/sqm - invalid floor area data'
        )
      );
      continue;
    }
    
    // Size similarity filter (now both subject and comp have floor area)
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
  // All kept comps now have valid pricePerSqm (guaranteed by floor area filter above)
  const pricesPerSqm = kept.map((c) => c.pricePerSqm as number);
  
  if (pricesPerSqm.length >= 4) {
    const bounds = calculateIQRBounds(pricesPerSqm, filterConfig.outlierIqrMultiplier);
    const mean = pricesPerSqm.reduce((a, b) => a + b, 0) / pricesPerSqm.length;
    
    const finalKept: NormalizedComparable[] = [];
    
    for (const comp of kept) {
      const pricePerSqm = comp.pricePerSqm as number;
      
      if (pricePerSqm < bounds.lower) {
        rejected.push(
          reject(
            comp,
            'outlier_low',
            `Price £${Math.round(pricePerSqm)}/sqm is below IQR lower bound (£${Math.round(bounds.lower)}/sqm), mean is £${Math.round(mean)}/sqm`
          )
        );
        continue;
      }
      
      if (pricePerSqm > bounds.upper) {
        rejected.push(
          reject(
            comp,
            'outlier_high',
            `Price £${Math.round(pricePerSqm)}/sqm is above IQR upper bound (£${Math.round(bounds.upper)}/sqm), mean is £${Math.round(mean)}/sqm`
          )
        );
        continue;
      }
      
      finalKept.push(comp);
    }
    
    return {
      kept: finalKept,
      rejected,
      stats: calculateStats(finalKept),
    };
  }
  
  // Not enough comps for outlier detection (< 4), keep all that passed basic filters
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


