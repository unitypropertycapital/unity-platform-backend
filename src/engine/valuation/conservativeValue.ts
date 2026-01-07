/**
 * Conservative Value Calculation
 * 
 * Implements the Conservative Valuation Mode:
 * - Uses P25/median blend for base £/sqm (biased toward cheaper comps)
 * - Applies multiplicative penalties for risk factors
 * - Only applies block/ex-LA penalties to flats
 */

import { config } from '../../utils/config';
import type { NormalizedComparable } from '../../types/comparable';

/**
 * Conservative market value band
 */
export interface ConservativeMarketValue {
  low: number;
  central: number;
  high: number;
}

/**
 * Diagnostics for conservative calculation
 */
export interface ConservativeDiagnostics {
  p25Psqm: number | null;
  medianPsqm: number | null;
  basePsqm: number | null;
  exLAScore: number;
  isExLocalAuthority: boolean;
  blockPenalty: number;
  smallUnitPenalty: number;
  confidencePenalty: number;
  cvPenalty: number;
  rawValue: number | null;
  conservativeCentral: number | null;
  constructionAgeBand: string | null;
  flatStoreyCount: number | null;
}

/**
 * Input for conservative value calculation
 */
export interface ConservativeValueInput {
  comps: NormalizedComparable[];
  subjectFloorAreaSqm: number | null;
  isFlatBlock: boolean;
  exLAScore: number;
  isExLocalAuthority: boolean;
  constructionAgeBand: string | null;
  flatStoreyCount: number | null;
  confidenceScore: number;
  coefficientOfVariation: number | null;
}

/**
 * Result of conservative value calculation
 */
export interface ConservativeValueResult {
  conservativeMarketValue: ConservativeMarketValue | null;
  diagnostics: ConservativeDiagnostics;
}

/**
 * Calculate percentile of an array
 */
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  
  if (lower === upper) {
    return sorted[lower];
  }
  
  const fraction = index - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

/**
 * Calculate base £/sqm using P25/median blend
 * 
 * Formula: base_psqm = 0.7 * P25 + 0.3 * median
 * This intentionally biases toward the cheaper end of comps
 */
export function calculateBasePsqm(
  pricesPerSqm: number[]
): { p25: number; median: number; base: number } {
  if (pricesPerSqm.length === 0) {
    return { p25: 0, median: 0, base: 0 };
  }
  
  const p25 = percentile(pricesPerSqm, 25);
  const median = percentile(pricesPerSqm, 50);
  const base = 0.7 * p25 + 0.3 * median;
  
  return {
    p25: Math.round(p25),
    median: Math.round(median),
    base: Math.round(base),
  };
}

/**
 * Calculate block penalty (for flats only)
 * 
 * Penalties:
 * - Tower block (10+ floors): +5%
 * - Ex-LA: +7%
 * - 1960-1983 construction: +3%
 * - Unknown cladding on 6+ floors: +3%
 * 
 * Capped at 15% total
 */
export function calculateBlockPenalty(
  isFlatBlock: boolean,
  isExLocalAuthority: boolean,
  constructionAgeBand: string | null,
  flatStoreyCount: number | null
): number {
  // Block penalties only apply to flats
  if (!isFlatBlock) {
    return 0;
  }
  
  let penalty = 0;
  
  // Tower block penalty (10+ floors)
  if (flatStoreyCount !== null && flatStoreyCount >= 10) {
    penalty += config.conservative.towerPenalty;
  }
  
  // Ex-LA penalty
  if (isExLocalAuthority) {
    penalty += config.conservative.exLAPenalty;
  }
  
  // 1960-1983 construction penalty
  if (constructionAgeBand) {
    const normalized = constructionAgeBand.toLowerCase();
    if (
      normalized.includes('1960') ||
      normalized.includes('1967') ||
      normalized.includes('1970') ||
      normalized.includes('1976') ||
      normalized.includes('1980') ||
      normalized.includes('1983')
    ) {
      penalty += config.conservative.eraPenalty;
    }
  }
  
  // Cladding unknown penalty (6+ floors)
  // Since we don't have cladding data, assume unknown for tall buildings
  if (flatStoreyCount !== null && flatStoreyCount >= 6) {
    penalty += config.conservative.claddingPenalty;
  }
  
  // Cap at configured max
  return Math.min(penalty, config.conservative.maxBlockPenalty);
}

/**
 * Calculate small unit penalty
 * 
 * Penalties:
 * - <50 sqm: 10%
 * - 50-60 sqm: 6%
 * - 60+ sqm: 0%
 */
export function calculateSmallUnitPenalty(floorAreaSqm: number | null): number {
  if (floorAreaSqm === null) {
    return 0;
  }
  
  if (floorAreaSqm < config.conservative.verySmallUnitThreshold) {
    return config.conservative.verySmallUnitPenalty;
  }
  
  if (floorAreaSqm < config.conservative.smallUnitThreshold) {
    return config.conservative.smallUnitPenalty;
  }
  
  return 0;
}

/**
 * Calculate confidence penalty
 * 
 * Penalties based on confidence score (from config):
 * - 80+: highConfidencePenalty
 * - 70-79: mediumConfidencePenalty
 * - 60-69: lowConfidencePenalty
 * - <60: veryLowConfidencePenalty
 */
export function calculateConfidencePenalty(confidenceScore: number): number {
  if (confidenceScore >= 80) {
    return config.conservative.highConfidencePenalty;
  }
  
  if (confidenceScore >= 70) {
    return config.conservative.mediumConfidencePenalty;
  }
  
  if (confidenceScore >= 60) {
    return config.conservative.lowConfidencePenalty;
  }
  
  return config.conservative.veryLowConfidencePenalty;
}

/**
 * Calculate CV (price dispersion) penalty
 * 
 * Penalties based on coefficient of variation (from config):
 * - CV >= highCVThreshold: highCVPenalty
 * - CV >= mediumCVThreshold: mediumCVPenalty
 * - CV < mediumCVThreshold: 0%
 */
export function calculateCvPenalty(cv: number | null): number {
  if (cv === null) {
    return 0;
  }
  
  if (cv >= config.conservative.highCVThreshold) {
    return config.conservative.highCVPenalty;
  }
  
  if (cv >= config.conservative.mediumCVThreshold) {
    return config.conservative.mediumCVPenalty;
  }
  
  return 0;
}

/**
 * Calculate conservative market value
 * 
 * Process:
 * 1. Calculate base £/sqm using P25/median blend
 * 2. Calculate raw value = base_psqm * floor_area
 * 3. Apply penalties: value *= (1 - penalty) for each
 * 4. Calculate band: ±5%
 */
export function calculateConservativeValue(
  input: ConservativeValueInput
): ConservativeValueResult {
  const {
    comps,
    subjectFloorAreaSqm,
    isFlatBlock,
    exLAScore,
    isExLocalAuthority,
    constructionAgeBand,
    flatStoreyCount,
    confidenceScore,
    coefficientOfVariation,
  } = input;
  
  // Extract valid £/sqm values
  const pricesPerSqm = comps
    .map((c) => c.pricePerSqm)
    .filter((p): p is number => p !== null);
  
  // Calculate base £/sqm
  const { p25, median, base } = calculateBasePsqm(pricesPerSqm);
  
  // Calculate penalties
  const blockPenalty = calculateBlockPenalty(
    isFlatBlock,
    isExLocalAuthority,
    constructionAgeBand,
    flatStoreyCount
  );
  const smallUnitPenalty = calculateSmallUnitPenalty(subjectFloorAreaSqm);
  const confidencePenalty = calculateConfidencePenalty(confidenceScore);
  const cvPenalty = calculateCvPenalty(coefficientOfVariation);
  
  // Build diagnostics
  const diagnostics: ConservativeDiagnostics = {
    p25Psqm: p25 || null,
    medianPsqm: median || null,
    basePsqm: base || null,
    exLAScore,
    isExLocalAuthority,
    blockPenalty,
    smallUnitPenalty,
    confidencePenalty,
    cvPenalty,
    rawValue: null,
    conservativeCentral: null,
    constructionAgeBand,
    flatStoreyCount,
  };
  
  // Can't calculate without floor area or base price
  if (subjectFloorAreaSqm === null || base === 0) {
    return {
      conservativeMarketValue: null,
      diagnostics,
    };
  }
  
  // Calculate raw value
  const rawValue = base * subjectFloorAreaSqm;
  diagnostics.rawValue = Math.round(rawValue);
  
  // Apply penalties sequentially
  let value = rawValue;
  value *= (1 - blockPenalty);
  value *= (1 - smallUnitPenalty);
  value *= (1 - confidencePenalty);
  value *= (1 - cvPenalty);
  
  const conservativeCentral = Math.round(value);
  diagnostics.conservativeCentral = conservativeCentral;
  
  // Calculate band (±5%)
  const bandPercent = config.conservative.bandPercent;
  const conservativeMarketValue: ConservativeMarketValue = {
    low: Math.round(conservativeCentral * (1 - bandPercent)),
    central: conservativeCentral,
    high: Math.round(conservativeCentral * (1 + bandPercent)),
  };
  
  return {
    conservativeMarketValue,
    diagnostics,
  };
}

