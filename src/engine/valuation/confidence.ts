/**
 * Confidence Score Calculation
 * Calculates confidence based on comp count, radius, variance, and recency
 */

import { config } from '../../utils/config';

/**
 * Confidence level labels
 */
export type ConfidenceLabel = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Confidence result with score and breakdown
 */
export interface ConfidenceResult {
  score: number;
  label: ConfidenceLabel;
  factors: {
    compCount: number;
    radius: number;
    variance: number;
    recency: number;
  };
}

/**
 * Parameters for confidence calculation
 */
export interface ConfidenceInput {
  compsCount: number;
  radiusUsed: number;
  stdDevPsqm: number | null;
  meanPsqm: number | null;
  avgAgeMonths: number | null;
}

/**
 * Calculate comp count factor (0-25 points)
 * 
 * More comps = higher confidence
 * - 10+ comps: 25 points
 * - 7-9 comps: 20 points
 * - 5-6 comps: 15 points
 * - 3-4 comps: 10 points
 * - <3 comps: 5 points
 */
export function calculateCompCountFactor(count: number): number {
  if (count >= 10) return 25;
  if (count >= 7) return 20;
  if (count >= 5) return 15;
  if (count >= 3) return 10;
  return 5;
}

/**
 * Calculate radius factor (0-25 points)
 * 
 * Smaller radius = higher confidence
 * - ≤0.15 miles: 25 points
 * - ≤0.25 miles: 20 points
 * - ≤0.35 miles: 15 points
 * - ≤0.45 miles: 10 points
 * - >0.45 miles: 5 points
 */
export function calculateRadiusFactor(radiusMiles: number): number {
  if (radiusMiles <= 0.15) return 25;
  if (radiusMiles <= 0.25) return 20;
  if (radiusMiles <= 0.35) return 15;
  if (radiusMiles <= 0.45) return 10;
  return 5;
}

/**
 * Calculate variance factor (0-25 points)
 * 
 * Lower CV (coefficient of variation) = higher confidence
 * - CV ≤0.10: 25 points
 * - CV ≤0.15: 20 points
 * - CV ≤0.20: 15 points
 * - CV ≤0.25: 10 points
 * - CV >0.25: 5 points
 */
export function calculateVarianceFactor(
  stdDev: number | null,
  mean: number | null
): number {
  if (stdDev === null || mean === null || mean === 0) {
    return 15; // Neutral score if unknown
  }
  
  const cv = stdDev / mean;
  
  if (cv <= 0.10) return 25;
  if (cv <= 0.15) return 20;
  if (cv <= 0.20) return 15;
  if (cv <= 0.25) return 10;
  return 5;
}

/**
 * Calculate recency factor (0-25 points)
 * 
 * More recent comps = higher confidence
 * - ≤6 months avg: 25 points
 * - ≤9 months avg: 20 points
 * - ≤12 months avg: 15 points
 * - ≤18 months avg: 10 points
 * - >18 months avg: 5 points
 */
export function calculateRecencyFactor(avgAgeMonths: number | null): number {
  if (avgAgeMonths === null) {
    return 15; // Neutral score if unknown
  }
  
  if (avgAgeMonths <= 6) return 25;
  if (avgAgeMonths <= 9) return 20;
  if (avgAgeMonths <= 12) return 15;
  if (avgAgeMonths <= 18) return 10;
  return 5;
}

/**
 * Determine confidence label from score
 */
export function determineConfidenceLabel(score: number): ConfidenceLabel {
  const { confidenceHighThreshold, confidenceMediumThreshold } = config.valuation;
  
  if (score >= confidenceHighThreshold) return 'HIGH';
  if (score >= confidenceMediumThreshold) return 'MEDIUM';
  return 'LOW';
}

/**
 * Calculate average age of comparables in months
 */
export function calculateAverageAge(ageMonths: number[]): number {
  if (ageMonths.length === 0) return 24; // Default to max if no data
  return ageMonths.reduce((a, b) => a + b, 0) / ageMonths.length;
}

/**
 * Calculate confidence score and label
 * 
 * Total score: 0-100
 * - Comp count: 0-25
 * - Radius: 0-25
 * - Variance: 0-25
 * - Recency: 0-25
 */
export function calculateConfidence(input: ConfidenceInput): ConfidenceResult {
  const { compsCount, radiusUsed, stdDevPsqm, meanPsqm, avgAgeMonths } = input;
  
  const compCount = calculateCompCountFactor(compsCount);
  const radius = calculateRadiusFactor(radiusUsed);
  const variance = calculateVarianceFactor(stdDevPsqm, meanPsqm);
  const recency = calculateRecencyFactor(avgAgeMonths);
  
  const score = compCount + radius + variance + recency;
  const label = determineConfidenceLabel(score);
  
  return {
    score,
    label,
    factors: {
      compCount,
      radius,
      variance,
      recency,
    },
  };
}

