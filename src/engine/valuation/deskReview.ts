/**
 * Desk Review Triggers
 * Determines when a valuation should be flagged for manual review
 */

import { config } from '../../utils/config';

/**
 * Reasons for desk review
 */
export type DeskReviewReason =
  | 'insufficient_comps'
  | 'missing_floor_area'
  | 'extreme_variance'
  | 'stale_data'
  | 'fetch_error'
  | 'address_not_found'
  | 'no_epc_data';

/**
 * Desk review result
 */
export interface DeskReviewResult {
  required: boolean;
  reason: DeskReviewReason | null;
  message: string | null;
}

/**
 * Parameters for desk review check
 */
export interface DeskReviewInput {
  subjectFloorAreaSqm: number | null;
  compsKept: number;
  stdDevPsqm: number | null;
  meanPsqm: number | null;
  avgAgeMonths: number | null;
}

/**
 * Check if desk review was already flagged upstream
 */
export function wasAlreadyFlaggedForReview(
  deskReview: boolean,
  reason: string | null
): DeskReviewResult {
  if (deskReview) {
    return {
      required: true,
      reason: (reason as DeskReviewReason) || 'fetch_error',
      message: `Prior flag: ${reason || 'Unknown reason'}`,
    };
  }
  
  return {
    required: false,
    reason: null,
    message: null,
  };
}

/**
 * Check for insufficient comparables
 * Minimum 3 kept comps required
 */
function checkInsufficientComps(compsKept: number): DeskReviewResult | null {
  if (compsKept < config.valuation.minCompsForValuation) {
    return {
      required: true,
      reason: 'insufficient_comps',
      message: `Only ${compsKept} comparable(s) found. Minimum ${config.valuation.minCompsForValuation} required for automated valuation.`,
    };
  }
  return null;
}

/**
 * Check for missing floor area
 * Required for £/sqm calculation
 */
function checkMissingFloorArea(floorAreaSqm: number | null): DeskReviewResult | null {
  if (floorAreaSqm === null || floorAreaSqm === 0) {
    return {
      required: true,
      reason: 'missing_floor_area',
      message: 'Subject property floor area is missing or zero. Cannot calculate £/sqm valuation.',
    };
  }
  return null;
}

/**
 * Check for extreme variance in comparable prices
 * High CV indicates unreliable estimate
 */
function checkExtremeVariance(
  stdDev: number | null,
  mean: number | null
): DeskReviewResult | null {
  if (stdDev === null || mean === null || mean === 0) {
    return null; // Can't check without data
  }
  
  const cv = stdDev / mean;
  
  if (cv > config.valuation.maxCoefficientOfVariation) {
    return {
      required: true,
      reason: 'extreme_variance',
      message: `Price variance is too high (CV: ${(cv * 100).toFixed(0)}%). Comparables may not be representative.`,
    };
  }
  return null;
}

/**
 * Check for stale data
 * If average comp age is too old, data may be outdated
 */
function checkStaleData(avgAgeMonths: number | null): DeskReviewResult | null {
  if (avgAgeMonths === null) {
    return null;
  }
  
  if (avgAgeMonths > config.valuation.maxAverageAgeMonths) {
    return {
      required: true,
      reason: 'stale_data',
      message: `Average comparable age is ${Math.round(avgAgeMonths)} months. Data may be too old for accurate valuation.`,
    };
  }
  return null;
}

/**
 * Check all desk review triggers
 * Returns first triggered condition
 */
export function checkDeskReview(input: DeskReviewInput): DeskReviewResult {
  const {
    subjectFloorAreaSqm,
    compsKept,
    stdDevPsqm,
    meanPsqm,
    avgAgeMonths,
  } = input;
  
  // Check triggers in order of priority
  const checks = [
    checkMissingFloorArea(subjectFloorAreaSqm),
    checkInsufficientComps(compsKept),
    checkExtremeVariance(stdDevPsqm, meanPsqm),
    checkStaleData(avgAgeMonths),
  ];
  
  // Return first triggered check
  for (const check of checks) {
    if (check !== null) {
      return check;
    }
  }
  
  // All checks passed
  return {
    required: false,
    reason: null,
    message: null,
  };
}

/**
 * Create a desk review result for API errors
 */
export function createFetchErrorResult(errorMessage: string): DeskReviewResult {
  return {
    required: true,
    reason: 'fetch_error',
    message: errorMessage,
  };
}

/**
 * Create a desk review result for address not found
 */
export function createAddressNotFoundResult(): DeskReviewResult {
  return {
    required: true,
    reason: 'address_not_found',
    message: 'Property address could not be resolved or verified.',
  };
}

/**
 * Create a desk review result for no EPC data
 */
export function createNoEpcResult(): DeskReviewResult {
  return {
    required: true,
    reason: 'no_epc_data',
    message: 'No EPC record found for this property. Floor area unknown.',
  };
}






