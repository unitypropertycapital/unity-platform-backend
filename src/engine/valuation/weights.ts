/**
 * Comparable Weighting
 * Calculates weights for each comparable based on distance, recency, and size similarity
 */

import type { NormalizedComparable } from '../../types/comparable';

/**
 * Individual weight components
 */
export interface CompWeight {
  distance: number;
  recency: number;
  size: number;
  total: number;
}

/**
 * A comparable with its calculated weight
 */
export interface WeightedComp {
  comp: NormalizedComparable;
  weight: CompWeight;
}

/**
 * Result of weighted £/sqm calculation
 */
export interface WeightedPsqmResult {
  weightedMedianPsqm: number;
  weightedMeanPsqm: number;
  weightedComps: WeightedComp[];
}

/**
 * Calculate distance weight
 * Closer comps get higher weight
 * 
 * Formula: max(0, 1 - (distance / 0.5))
 * - At 0 miles: weight = 1.0
 * - At 0.25 miles: weight = 0.5
 * - At 0.5+ miles: weight = 0
 */
export function calculateDistanceWeight(distanceMiles: number): number {
  const maxDistance = 0.5; // miles
  const weight = Math.max(0, 1 - (distanceMiles / maxDistance));
  return Math.round(weight * 100) / 100;
}

/**
 * Calculate recency weight
 * More recent sales get higher weight
 * 
 * Formula: max(0, 1 - (ageMonths / 24))
 * - At 0 months: weight = 1.0
 * - At 12 months: weight = 0.5
 * - At 24+ months: weight = 0
 */
export function calculateRecencyWeight(ageMonths: number): number {
  const maxAge = 24; // months
  const weight = Math.max(0, 1 - (ageMonths / maxAge));
  return Math.round(weight * 100) / 100;
}

/**
 * Calculate size similarity weight
 * Similar sizes get higher weight
 * 
 * Formula: max(0, 1 - abs(sizeDiff) / 0.3)
 * - At 0% diff: weight = 1.0
 * - At 15% diff: weight = 0.5
 * - At 30%+ diff: weight = 0
 */
export function calculateSizeWeight(
  compSqm: number | null,
  subjectSqm: number | null
): number {
  // If either size is unknown, use neutral weight
  if (compSqm === null || subjectSqm === null) {
    return 0.5;
  }
  
  const sizeDiff = Math.abs(compSqm - subjectSqm) / subjectSqm;
  const maxDiff = 0.3; // 30%
  const weight = Math.max(0, 1 - (sizeDiff / maxDiff));
  return Math.round(weight * 100) / 100;
}

/**
 * Calculate total weight for a comparable
 * 
 * Total = distance * 0.35 + recency * 0.35 + size * 0.30
 */
export function calculateTotalWeight(components: Omit<CompWeight, 'total'>): number {
  const total =
    components.distance * 0.35 +
    components.recency * 0.35 +
    components.size * 0.30;
  return Math.round(total * 100) / 100;
}

/**
 * Calculate weights for all comparables
 */
export function calculateWeights(
  comps: NormalizedComparable[],
  subjectFloorAreaSqm: number | null
): WeightedComp[] {
  return comps.map((comp) => {
    const distance = calculateDistanceWeight(comp.distanceMiles);
    const recency = calculateRecencyWeight(comp.ageMonths);
    const size = calculateSizeWeight(comp.floorAreaSqm, subjectFloorAreaSqm);
    const total = calculateTotalWeight({ distance, recency, size });
    
    return {
      comp,
      weight: { distance, recency, size, total },
    };
  });
}

/**
 * Calculate weighted median £/sqm
 * Uses repeated sampling based on weights
 */
export function weightedMedian(values: number[], weights: number[]): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  
  // Create weighted samples
  const samples: Array<{ value: number; weight: number }> = values.map((v, i) => ({
    value: v,
    weight: weights[i] || 0,
  }));
  
  // Sort by value
  samples.sort((a, b) => a.value - b.value);
  
  // Find median using cumulative weights
  const totalWeight = samples.reduce((sum, s) => sum + s.weight, 0);
  const halfWeight = totalWeight / 2;
  
  let cumWeight = 0;
  for (const sample of samples) {
    cumWeight += sample.weight;
    if (cumWeight >= halfWeight) {
      return sample.value;
    }
  }
  
  // Fallback to last value
  return samples[samples.length - 1].value;
}

/**
 * Calculate weighted mean £/sqm
 */
export function weightedMean(values: number[], weights: number[]): number {
  if (values.length === 0) return 0;
  
  let sumWeightedValues = 0;
  let sumWeights = 0;
  
  for (let i = 0; i < values.length; i++) {
    const weight = weights[i] || 0;
    sumWeightedValues += values[i] * weight;
    sumWeights += weight;
  }
  
  if (sumWeights === 0) {
    // Fallback to simple mean
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
  
  return sumWeightedValues / sumWeights;
}

/**
 * Calculate weighted £/sqm from comparables
 * Returns both weighted median and weighted mean for diagnostics
 */
export function calculateWeightedPsqm(
  comps: NormalizedComparable[],
  subjectFloorAreaSqm: number | null
): WeightedPsqmResult {
  // Calculate weights
  const weightedComps = calculateWeights(comps, subjectFloorAreaSqm);
  
  // Extract values and weights for comps with valid £/sqm
  const validComps = weightedComps.filter((wc) => wc.comp.pricePerSqm !== null);
  const values = validComps.map((wc) => wc.comp.pricePerSqm!);
  const weights = validComps.map((wc) => wc.weight.total);
  
  // Calculate weighted statistics
  const weightedMedianPsqm = Math.round(weightedMedian(values, weights));
  const weightedMeanPsqm = Math.round(weightedMean(values, weights));
  
  return {
    weightedMedianPsqm,
    weightedMeanPsqm,
    weightedComps,
  };
}






