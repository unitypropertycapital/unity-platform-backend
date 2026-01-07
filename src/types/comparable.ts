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
  isExLA: boolean;        // Ex-local authority classification
  exLAScore: number;      // Ex-LA detection score (0-4)
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
  | 'invalid_data'
  | 'new_build_excluded'
  | 'market_segment_mismatch';

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
 * Enrichment stats from tiered API call approach
 */
export interface EnrichmentStats {
  tier: 1 | 2 | 3;           // 1 = subject only, 2 = escalated, 3 = insufficient
  apiCallsMade: number;       // Number of /floor-areas API calls
  compsWithFloorArea: number; // Comps that got floor area data
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
  enrichmentStats?: EnrichmentStats; // Tiered API call stats
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
  subjectIsExLA: boolean;  // Ex-LA classification for market segmentation
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
