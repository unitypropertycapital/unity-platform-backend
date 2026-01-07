/**
 * Offer Range Calculation
 * Calculates Moov offer ranges based on market value and seller timeline
 */

import { config } from '../../utils/config';
import type { SaleTimeline } from '../../types/request';

/**
 * Offer range (low to high)
 */
export interface OfferRange {
  low: number;
  high: number;
}

/**
 * Offer type identifier
 */
export type OfferType = 'FAST_TRACK' | 'FLEXIBLE';

/**
 * Complete offer result
 */
export interface OffersResult {
  fastTrack: OfferRange;
  flexible: OfferRange;
  selectedOfferType: OfferType;
}

/**
 * Calculate offer range based on percentage of market value
 */
function calculateOfferRange(
  centralMV: number,
  lowPercent: number,
  highPercent: number
): OfferRange {
  return {
    low: Math.round(centralMV * lowPercent),
    high: Math.round(centralMV * highPercent),
  };
}

/**
 * Determine which offer type to highlight based on seller timeline
 * 
 * Fast-Track: For urgent sellers (0-8 weeks)
 *   - Lower offer (75-85% of MV)
 *   - Quick completion
 * 
 * Flexible: For less urgent sellers (8-16+ weeks)
 *   - Higher offer (85-92% of MV)
 *   - More time for Moov to market
 */
export function determineOfferType(saleTimeline: SaleTimeline): OfferType {
  if (saleTimeline === '0-8_weeks') {
    return 'FAST_TRACK';
  }
  return 'FLEXIBLE';
}

/**
 * Calculate all offer ranges
 * 
 * @param centralMarketValue - The central market value estimate
 * @param saleTimeline - The seller's preferred sale timeline
 * @returns Both offer ranges and which one is selected
 */
export function calculateOffers(
  centralMarketValue: number,
  saleTimeline: SaleTimeline
): OffersResult {
  const { fastTrackLow, fastTrackHigh, flexibleLow, flexibleHigh } = config.valuation;
  
  return {
    fastTrack: calculateOfferRange(centralMarketValue, fastTrackLow, fastTrackHigh),
    flexible: calculateOfferRange(centralMarketValue, flexibleLow, flexibleHigh),
    selectedOfferType: determineOfferType(saleTimeline),
  };
}

/**
 * Round offer values to nearest sensible figure
 * £1,000 for values under £100k
 * £5,000 for values under £500k
 * £10,000 for values above £500k
 */
export function roundOfferValue(value: number): number {
  if (value < 100000) {
    return Math.round(value / 1000) * 1000;
  }
  if (value < 500000) {
    return Math.round(value / 5000) * 5000;
  }
  return Math.round(value / 10000) * 10000;
}

/**
 * Calculate offers with rounded values for cleaner display
 */
export function calculateOffersRounded(
  centralMarketValue: number,
  saleTimeline: SaleTimeline
): OffersResult {
  const result = calculateOffers(centralMarketValue, saleTimeline);
  
  return {
    fastTrack: {
      low: roundOfferValue(result.fastTrack.low),
      high: roundOfferValue(result.fastTrack.high),
    },
    flexible: {
      low: roundOfferValue(result.flexible.low),
      high: roundOfferValue(result.flexible.high),
    },
    selectedOfferType: result.selectedOfferType,
  };
}

// ============================================
// Conservative Offer Calculations
// ============================================

/**
 * Calculate conservative offer ranges
 * 
 * Uses conservative percentages:
 * - Fast-Track: 75-82% (vs standard 75-85%)
 * - Flexible: 82-88% (vs standard 85-92%)
 * 
 * These are based on conservativeMarketValue.central, not standard marketValue
 */
export function calculateConservativeOffers(
  conservativeCentral: number,
  saleTimeline: SaleTimeline
): OffersResult {
  const { fastTrackLow, fastTrackHigh, flexibleLow, flexibleHigh } = config.conservative;
  
  return {
    fastTrack: calculateOfferRange(conservativeCentral, fastTrackLow, fastTrackHigh),
    flexible: calculateOfferRange(conservativeCentral, flexibleLow, flexibleHigh),
    selectedOfferType: determineOfferType(saleTimeline),
  };
}

/**
 * Calculate conservative offers with rounded values
 */
export function calculateConservativeOffersRounded(
  conservativeCentral: number,
  saleTimeline: SaleTimeline
): OffersResult {
  const result = calculateConservativeOffers(conservativeCentral, saleTimeline);
  
  return {
    fastTrack: {
      low: roundOfferValue(result.fastTrack.low),
      high: roundOfferValue(result.fastTrack.high),
    },
    flexible: {
      low: roundOfferValue(result.flexible.low),
      high: roundOfferValue(result.flexible.high),
    },
    selectedOfferType: result.selectedOfferType,
  };
}








