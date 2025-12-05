/**
 * Comparable Property Types
 * Types for raw, normalized, and filtered comparable sales data
 */

/**
 * Raw comparable data as received from data sources
 */
export interface RawComparable {
  address: string;
  postcode: string;
  salePrice: number;
  saleDate: string;
  propertyType: string;
  latitude: number;
  longitude: number;
  floorAreaSqm: number | null;
  source: 'LR' | 'PD';
}

/**
 * Normalized comparable with calculated fields
 */
export interface NormalizedComparable extends RawComparable {
  distanceMiles: number;
  pricePerSqm: number | null;
  pricePerSqft: number | null;
  ageMonths: number;
}

/**
 * Rejection reasons for filtered comps
 */
export type RejectionReason =
  | 'wrong_property_type'
  | 'too_old'
  | 'size_mismatch'
  | 'outlier_high'
  | 'outlier_low'
  | 'no_floor_area'
  | 'outside_radius'
  | 'invalid_data';

/**
 * Rejected comparable with reason
 */
export interface RejectedComparable {
  comp: NormalizedComparable;
  reason: RejectionReason;
  details: string;
}

/**
 * Statistics for kept comparables
 */
export interface ComparableStats {
  count: number;
  meanPricePerSqm: number | null;
  medianPricePerSqm: number | null;
  minPricePerSqm: number | null;
  maxPricePerSqm: number | null;
  stdDevPricePerSqm: number | null;
}

/**
 * Debug info for radius expansion attempts
 */
export interface RadiusAttempt {
  radius: number;
  rawComps: number;
  afterFilters: number;
}

/**
 * Complete result from comparable fetching and filtering
 */
export interface ComparablesResult {
  radiusUsed: number;
  radiusAttempts: RadiusAttempt[]; // MAT-2.1: Debug output for radius expansion
  totalFound: number;
  totalKept: number;
  totalRejected: number;
  kept: NormalizedComparable[];
  rejected: RejectedComparable[];
  stats: ComparableStats;
  deskReview: boolean;
  deskReviewReason: string | null;
}

/**
 * Input parameters for fetching comparables
 */
export interface ComparableFetchParams {
  postcode: string;
  latitude: number;
  longitude: number;
  propertyType: string;
  floorAreaSqm: number | null;
}

/**
 * Filter configuration
 */
export interface ComparableFilterConfig {
  propertyType: string;
  floorAreaSqm: number | null;
  maxRecencyMonths: number;
  sizeTolerance: number;
  outlierIqrMultiplier: number;
  minComps: number;
}

