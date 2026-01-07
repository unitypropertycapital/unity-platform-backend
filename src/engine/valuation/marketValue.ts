/**
 * Market Value Calculation
 * Calculates market value band from weighted £/sqm
 */

import { config } from '../../utils/config';

/**
 * Market value band with low, central, and high estimates
 */
export interface MarketValueBand {
  low: number;
  central: number;
  high: number;
  bandPercent: number;
}

/**
 * Parameters for market value calculation
 */
export interface MarketValueInput {
  weightedMedianPsqm: number;
  subjectFloorAreaSqm: number;
  radiusUsed: number;
  confidenceScore: number;
}

/**
 * Determine the band percentage based on data quality
 * 
 * Normal band: ±8% (high confidence, small radius)
 * Wide band: ±10% (lower confidence, larger radius)
 */
export function determineBandPercent(
  radiusUsed: number,
  confidenceScore: number
): number {
  const { bandPercentNormal, bandPercentWide, confidenceHighThreshold } = config.valuation;
  
  // Use wide band if confidence is below threshold OR radius is large
  if (confidenceScore < confidenceHighThreshold || radiusUsed > 0.4) {
    return bandPercentWide;
  }
  
  return bandPercentNormal;
}

/**
 * Calculate market value band
 * 
 * @param input - Calculation parameters
 * @returns Market value band with low, central, high
 */
export function calculateMarketValue(input: MarketValueInput): MarketValueBand {
  const {
    weightedMedianPsqm,
    subjectFloorAreaSqm,
    radiusUsed,
    confidenceScore,
  } = input;
  
  // Calculate central value
  const central = Math.round(weightedMedianPsqm * subjectFloorAreaSqm);
  
  // Determine band width
  const bandPercent = determineBandPercent(radiusUsed, confidenceScore);
  
  // Calculate low and high
  const low = Math.round(central * (1 - bandPercent));
  const high = Math.round(central * (1 + bandPercent));
  
  return {
    low,
    central,
    high,
    bandPercent,
  };
}

/**
 * Round market value to appropriate precision
 * For cleaner display
 * 
 * - Under £100k: round to nearest £1,000
 * - Under £500k: round to nearest £5,000
 * - £500k+: round to nearest £10,000
 */
export function roundMarketValue(value: number): number {
  if (value < 100000) {
    return Math.round(value / 1000) * 1000;
  }
  if (value < 500000) {
    return Math.round(value / 5000) * 5000;
  }
  return Math.round(value / 10000) * 10000;
}

/**
 * Calculate market value with rounded values
 */
export function calculateMarketValueRounded(
  input: MarketValueInput
): MarketValueBand {
  const result = calculateMarketValue(input);
  
  return {
    low: roundMarketValue(result.low),
    central: roundMarketValue(result.central),
    high: roundMarketValue(result.high),
    bandPercent: result.bandPercent,
  };
}

