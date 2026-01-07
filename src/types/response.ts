/**
 * API Response Types
 * Defines the shape of valuation API responses
 */

// ============================================
// Market Value Types
// ============================================

export interface MarketValue {
  low: number;
  central: number;
  high: number;
}

// ============================================
// Offer Types
// ============================================

export interface OfferRange {
  low: number;
  high: number;
}

export type OfferType = 'FAST_TRACK' | 'FLEXIBLE';

export interface Offers {
  fastTrack: OfferRange;
  flexible: OfferRange;
  selectedOfferType: OfferType;
}

// ============================================
// Confidence Types
// ============================================

export type ConfidenceLabel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Confidence {
  score: number;
  label: ConfidenceLabel;
}

// ============================================
// Diagnostics Types
// ============================================

export interface ValuationDiagnostics {
  radiusUsed: number;
  compsKept: number;
  compsRejected: number;
  weightedMedianPsqm: number | null;
  weightedMeanPsqm: number | null;
  bandPercent: number | null;
  avgAgeMonths: number | null;
  coefficientOfVariation: number | null;
}

// ============================================
// Conservative Valuation Types
// ============================================

/**
 * Conservative market value band
 * Uses P25/median blend and applies risk penalties
 */
export interface ConservativeMarketValue {
  low: number;
  central: number;
  high: number;
}

/**
 * Conservative diagnostics for calibration and debugging
 */
export interface ConservativeDiagnostics {
  /** 25th percentile £/sqm from comps */
  p25Psqm: number | null;
  /** Median £/sqm from comps */
  medianPsqm: number | null;
  /** Base £/sqm (0.7*P25 + 0.3*median) */
  basePsqm: number | null;
  /** Whether property is a flat/block */
  isFlatBlock: boolean;
  /** Ex-LA detection score (0-4) */
  exLAScore: number;
  /** Whether classified as ex-local authority */
  isExLocalAuthority: boolean;
  /** EPC construction age band */
  constructionAgeBand: string | null;
  /** Number of floors in building (for flats) */
  flatStoreyCount: number | null;
  /** Block penalty applied (tower, ex-LA, era, cladding) */
  blockPenalty: number;
  /** Small unit penalty (<50sqm or 50-60sqm) */
  smallUnitPenalty: number;
  /** Confidence-based penalty */
  confidencePenalty: number;
  /** CV (price dispersion) penalty */
  cvPenalty: number;
  /** Total penalty applied */
  totalPenalty: number;
  /** Raw value before penalties */
  rawValue: number | null;
  /** Final conservative central value */
  conservativeCentral: number | null;
}

// ============================================
// Subject Property Response
// ============================================

export interface SubjectPropertyResponse {
  line_1: string;
  line_2: string | null;
  line_3: string | null;
  post_town: string;
  postcode: string;
  normalizedAddress: string;
  uprn: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
}

// ============================================
// EPC Response
// ============================================

export interface EPCAvailableResponse {
  available: true;
  floorAreaSqm: number;
  floorAreaSqFt: number;
  habitableRooms: number | null;
  rating: string | null;
  score: number | null;
}

export interface EPCMissingResponse {
  available: false;
  missing_epc: true;
  reason: string;
}

export type EPCResponse = EPCAvailableResponse | EPCMissingResponse;

// ============================================
// Comparable Response Types
// ============================================

export interface ComparableKept {
  address: string;
  postcode: string;
  salePrice: number;
  saleDate: string;
  propertyType: string;
  floorAreaSqm: number | null;
  distanceMiles: number;
  pricePerSqm: number | null;
  pricePerSqft: number | null;
  ageMonths: number;
  source: 'LR' | 'PD';
  weight?: number;
}

export interface ComparableRejected {
  address: string;
  postcode: string;
  salePrice: number;
  saleDate: string;
  reason: string;
  details: string;
}

export interface ComparableStats {
  count: number;
  meanPricePerSqm: number | null;
  medianPricePerSqm: number | null;
  minPricePerSqm: number | null;
  maxPricePerSqm: number | null;
  stdDevPricePerSqm: number | null;
}

export interface RadiusAttempt {
  radius: number;
  rawComps: number;
  afterFilters: number;
}

export interface ComparablesResponse {
  radiusUsed: number;
  radiusAttempts: RadiusAttempt[];
  totalFound: number;
  totalKept: number;
  totalRejected: number;
  kept: ComparableKept[];
  rejected: ComparableRejected[];
  stats: ComparableStats;
}

// ============================================
// Main Valuation Response Types
// ============================================

/**
 * Successful valuation response
 * Contains market value, offers, and confidence
 */
export interface ValuationSuccessResponse {
  subjectProperty: SubjectPropertyResponse;
  epc: EPCResponse;
  streetViewUrl: string | null;
  streetViewAvailable: boolean;

  /** Original market value (weighted median based) */
  marketValue: MarketValue;
  
  /** Conservative market value (P25/median blend with penalties) */
  conservativeMarketValue: ConservativeMarketValue | null;
  
  /** Offers calculated from conservativeMarketValue.central */
  offers: Offers;
  confidence: Confidence;

  deskReview: false;
  deskReviewReason: null;

  diagnostics: ValuationDiagnostics;
  
  /** Conservative valuation diagnostics for calibration */
  conservativeDiagnostics: ConservativeDiagnostics | null;
  
  comparables: ComparablesResponse;

  timestamp: string;
}

/**
 * Desk review response
 * Returned when automated valuation cannot be performed
 */
export interface ValuationDeskReviewResponse {
  subjectProperty: SubjectPropertyResponse;
  epc: EPCResponse;
  streetViewUrl: string | null;
  streetViewAvailable: boolean;

  marketValue: null;
  offers: null;
  confidence: null;

  deskReview: true;
  deskReviewReason: string;

  diagnostics: Partial<ValuationDiagnostics>;
  comparables: ComparablesResponse | null;

  timestamp: string;
}

/**
 * Combined valuation response type
 */
export type ValuationResponse = ValuationSuccessResponse | ValuationDeskReviewResponse;

// ============================================
// Legacy Types (for backwards compatibility)
// ============================================

/**
 * @deprecated Use ComparableKept instead
 */
export interface ComparableProperty {
  source: 'LR' | 'PD';
  price: number;
  date: string;
  distanceMiles: number;
  floorAreaSqm: number | null;
  psqm: number | null;
  used: boolean;
}

