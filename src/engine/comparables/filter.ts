/**
 * Comparable Filter Module
 * Filters comparables by property type, recency, size, and outliers
 * 
 * Conservative Mode:
 * - Size tolerance: flats ±35%, houses ±30% (vs standard ±20%)
 * - Outlier detection: Q1 - 2.0*IQR (vs standard 1.5)
 * - Recency fallback: 36 months if <4 comps within 0.5mi
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
 * Flat-type property types (for size tolerance)
 */
const FLAT_TYPES = new Set(['flat', 'apartment', 'maisonette', 'studio']);

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
 * Filter comparables by market segment (ex-LA vs private)
 * 
 * If subject is ex-LA, only keep ex-LA comps.
 * If subject is private, only keep private comps.
 * 
 * This ensures base £/sqm calculations are segment-specific and not diluted by
 * mixing ex-LA and private properties (which have different price levels).
 * 
 * Only applies to flats - houses rarely have clear ex-LA classification.
 * 
 * @param comps - Comparables to filter
 * @param subjectIsExLA - Whether the subject property is ex-LA
 * @param subjectPropertyType - Subject property type
 * @param minCompsRequired - Minimum comps needed (fallback if filtering leaves too few)
 * @returns Filtered comparables with market segment mismatches removed
 */
export function filterByMarketSegment(
  comps: NormalizedComparable[],
  subjectIsExLA: boolean,
  subjectPropertyType: string,
  minCompsRequired: number = 4
): PreFilterResult {
  const propertyTypeNorm = subjectPropertyType.toLowerCase();
  const isFlatType = ['flat', 'apartment', 'maisonette'].includes(propertyTypeNorm);
  
  // Only apply market segment filtering to flats
  if (!isFlatType) {
    logger.info('Market segment filter: skipped (not a flat)');
    return { passed: comps, rejected: [] };
  }
  
  const passed: NormalizedComparable[] = [];
  const rejected: RejectedComparable[] = [];
  
  for (const comp of comps) {
    // Match market segment
    if (comp.isExLA === subjectIsExLA) {
      passed.push(comp);
    } else {
      const subjectSegment = subjectIsExLA ? 'ex-LA' : 'private';
      const compSegment = comp.isExLA ? 'ex-LA' : 'private';
      rejected.push(
        reject(
          comp,
          'market_segment_mismatch',
          `Subject is ${subjectSegment}, comp is ${compSegment}`
        )
      );
    }
  }
  
  // Fallback: if we filtered out too many comps, log warning and use all
  if (passed.length < minCompsRequired) {
    const segmentType = subjectIsExLA ? 'ex-LA' : 'private';
    logger.warn(
      `Market segment filter: only ${passed.length} ${segmentType} comps found (min ${minCompsRequired}). ` +
      `Using all ${comps.length} comps (mixed segment) as fallback.`
    );
    return { passed: comps, rejected: [] };
  }
  
  logger.info(
    `Market segment filter: kept ${passed.length} ${subjectIsExLA ? 'ex-LA' : 'private'} comps, ` +
    `rejected ${rejected.length} ${subjectIsExLA ? 'private' : 'ex-LA'} comps`
  );
  
  return { passed, rejected };
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

// ============================================
// Conservative Filtering (for Conservative Valuation Mode)
// ============================================

/**
 * Get size tolerance based on property type (conservative mode)
 * - Flats: ±35%
 * - Houses: ±30%
 */
export function getConservativeSizeTolerance(propertyType: string): number {
  const normalized = propertyType.toLowerCase();
  
  if (FLAT_TYPES.has(normalized)) {
    return config.conservative.flatSizeTolerance;
  }
  
  return config.conservative.houseSizeTolerance;
}

/**
 * Calculate IQR bounds for conservative outlier detection
 * Uses 2.0x IQR multiplier (more permissive) to keep cheaper comps
 */
function calculateConservativeIQRBounds(values: number[]): { lower: number; upper: number } {
  return calculateIQRBounds(values, config.conservative.outlierIqrMultiplier);
}

/**
 * Filter comparables with conservative settings
 * 
 * Key differences from standard filtering:
 * 1. Size tolerance: flats ±35%, houses ±30% (allows more comps through)
 * 2. Outlier detection: Q1 - 2.0*IQR (keeps cheaper comps)
 * 3. Recency fallback: 36 months if <4 comps and radius <= 0.5mi
 */
export function filterComparablesConservative(
  comps: NormalizedComparable[],
  filterConfig: ComparableFilterConfig,
  currentRadius: number
): FilterResult {
  const kept: NormalizedComparable[] = [];
  const rejected: RejectedComparable[] = [];
  
  // Determine size tolerance based on property type
  const sizeTolerance = getConservativeSizeTolerance(filterConfig.propertyType);
  
  // Determine max recency - use fallback if within 0.5mi radius
  let maxRecency = filterConfig.maxRecencyMonths;
  const needsRecencyFallback = currentRadius <= config.conservative.fallbackMaxRadius;
  
  // Step 1: Apply basic filters with conservative size tolerance
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
    
    // Recency filter (will be relaxed in fallback if needed)
    if (comp.ageMonths > maxRecency) {
      rejected.push(
        reject(
          comp,
          'too_old',
          `Sale date ${comp.ageMonths} months ago, max allowed is ${maxRecency} months`
        )
      );
      continue;
    }
    
    // Floor area filter - REQUIRED for £/sqm calculation
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
    
    // Price per sqm must be valid
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
    
    // Size similarity filter with CONSERVATIVE tolerance
    if (!isSizeWithinTolerance(filterConfig.floorAreaSqm, comp.floorAreaSqm, sizeTolerance)) {
      const tolerance = Math.round(sizeTolerance * 100);
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
  
  // Check if we need recency fallback
  if (kept.length < config.conservative.fallbackMinComps && needsRecencyFallback) {
    logger.info(`Conservative filter: ${kept.length}/${config.conservative.fallbackMinComps} comps, applying 36mo recency fallback`);
    
    // Re-filter with extended recency, keeping already-kept comps
    const fallbackRecency = config.conservative.fallbackRecencyMonths;
    
    for (const comp of comps) {
      // Skip if already kept or if it would fail non-recency filters
      if (kept.includes(comp)) continue;
      if (!comp.latitude || !comp.longitude || !comp.salePrice) continue;
      if (!isPropertyTypeMatch(filterConfig.propertyType, comp.propertyType)) continue;
      if (comp.floorAreaSqm === null || comp.floorAreaSqm <= 0) continue;
      if (comp.pricePerSqm === null) continue;
      if (!isSizeWithinTolerance(filterConfig.floorAreaSqm, comp.floorAreaSqm, sizeTolerance)) continue;
      
      // Check extended recency
      if (comp.ageMonths <= fallbackRecency && comp.ageMonths > maxRecency) {
        kept.push(comp);
        
        // Remove from rejected if it was added for too_old
        const rejectedIndex = rejected.findIndex(r => r.comp === comp && r.reason === 'too_old');
        if (rejectedIndex !== -1) {
          rejected.splice(rejectedIndex, 1);
        }
      }
    }
  }
  
  // Step 2: Apply CONSERVATIVE IQR outlier detection (2.0x multiplier)
  const pricesPerSqm = kept.map((c) => c.pricePerSqm as number);
  
  if (pricesPerSqm.length >= 4) {
    const bounds = calculateConservativeIQRBounds(pricesPerSqm);
    const mean = pricesPerSqm.reduce((a, b) => a + b, 0) / pricesPerSqm.length;
    
    const finalKept: NormalizedComparable[] = [];
    
    for (const comp of kept) {
      const pricePerSqm = comp.pricePerSqm as number;
      
      // Only reject LOW outliers if they're EXTREMELY low (2.0x IQR below Q1)
      // This keeps more cheap comps for conservative valuation
      if (pricePerSqm < bounds.lower) {
        rejected.push(
          reject(
            comp,
            'outlier_low',
            `Price £${Math.round(pricePerSqm)}/sqm is below conservative IQR lower bound (£${Math.round(bounds.lower)}/sqm), mean is £${Math.round(mean)}/sqm`
          )
        );
        continue;
      }
      
      if (pricePerSqm > bounds.upper) {
        rejected.push(
          reject(
            comp,
            'outlier_high',
            `Price £${Math.round(pricePerSqm)}/sqm is above conservative IQR upper bound (£${Math.round(bounds.upper)}/sqm), mean is £${Math.round(mean)}/sqm`
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
  
  // Not enough comps for outlier detection, keep all
  return {
    kept,
    rejected,
    stats: calculateStats(kept),
  };
}

/**
 * Calculate P25 (25th percentile) of price per sqm
 * Used for conservative valuation base price calculation
 */
export function calculateP25Psqm(comps: NormalizedComparable[]): number | null {
  const prices = comps
    .map(c => c.pricePerSqm)
    .filter((p): p is number => p !== null && p > 0)
    .sort((a, b) => a - b);
  
  if (prices.length === 0) return null;
  if (prices.length === 1) return prices[0];
  
  const index = Math.floor(prices.length * 0.25);
  return prices[index];
}

/**
 * Calculate median price per sqm
 */
export function calculateMedianPsqm(comps: NormalizedComparable[]): number | null {
  const prices = comps
    .map(c => c.pricePerSqm)
    .filter((p): p is number => p !== null && p > 0)
    .sort((a, b) => a - b);
  
  if (prices.length === 0) return null;
  
  const midIndex = Math.floor(prices.length / 2);
  
  if (prices.length % 2 === 0) {
    return (prices[midIndex - 1] + prices[midIndex]) / 2;
  }
  
  return prices[midIndex];
}

// ============================================
// New-Build Filtering for Ex-LA Properties
// ============================================

/**
 * Keywords that suggest a property is a new build development
 */
const NEW_BUILD_KEYWORDS = [
  /\bplot\b/i,
  /\bphase\b/i,
  /\bdevelopment\b/i,
  /\bnew\s+build\b/i,
  /\bnewly\s+built\b/i,
  /\bshow\s*flat\b/i,
  /\bshow\s*home\b/i,
];

/**
 * Check if a comparable appears to be a new-build property
 * 
 * Detection criteria:
 * 1. Address contains new-build keywords (Plot, Phase, Development, etc.)
 * 2. Sale within last 24 months AND price significantly above median (>130%)
 */
export function isLikelyNewBuild(
  comp: NormalizedComparable,
  medianPsqm: number | null
): { isNewBuild: boolean; reason: string } {
  // Check for new-build keywords in address
  for (const pattern of NEW_BUILD_KEYWORDS) {
    if (pattern.test(comp.address)) {
      return {
        isNewBuild: true,
        reason: `Address contains new-build keyword: ${comp.address.match(pattern)?.[0] || 'match'}`,
      };
    }
  }
  
  // Check for recent sale with significantly high price
  if (
    medianPsqm &&
    comp.pricePerSqm &&
    comp.ageMonths <= config.conservative.newBuildMaxAgeMonths
  ) {
    const priceRatio = comp.pricePerSqm / medianPsqm;
    if (priceRatio > config.conservative.newBuildPriceThreshold) {
      return {
        isNewBuild: true,
        reason: `Recent sale (${comp.ageMonths}mo) with high price: £${Math.round(comp.pricePerSqm)}/sqm is ${Math.round(priceRatio * 100)}% of median £${Math.round(medianPsqm)}/sqm`,
      };
    }
  }
  
  return { isNewBuild: false, reason: '' };
}

/**
 * Filter out new-build comparables for ex-LA valuations
 * 
 * When valuing ex-LA properties, new-build comps skew values upward.
 * This filter removes them to get more accurate ex-LA valuations.
 * 
 * @param comps - Comparables to filter
 * @param isExLA - Whether the subject property is ex-local authority
 * @returns Filtered comparables with new-builds removed (if ex-LA)
 */
export function filterNewBuildsForExLA(
  comps: NormalizedComparable[],
  isExLA: boolean
): { kept: NormalizedComparable[]; removed: RejectedComparable[] } {
  // Only apply filter for ex-LA properties
  if (!isExLA) {
    return { kept: comps, removed: [] };
  }
  
  // Calculate median for price threshold check
  const medianPsqm = calculateMedianPsqm(comps);
  
  const kept: NormalizedComparable[] = [];
  const removed: RejectedComparable[] = [];
  
  for (const comp of comps) {
    const { isNewBuild, reason } = isLikelyNewBuild(comp, medianPsqm);
    
    if (isNewBuild) {
      removed.push({
        comp,
        reason: 'new_build_excluded' as RejectionReason,
        details: `Ex-LA valuation: filtered out likely new-build. ${reason}`,
      });
    } else {
      kept.push(comp);
    }
  }
  
  // Log if we removed new builds
  if (removed.length > 0) {
    logger.info(`Ex-LA new-build filter: removed ${removed.length} likely new-build comps, ${kept.length} remaining`);
  }
  
  return { kept, removed };
}
