import { logger } from '../utils/logger';
import type { HealthCheckResult } from '../types/services';

/**
 * ONS House Price Index Service
 *
 * Used to time-adjust historical sale prices to present-day values.
 * For MVP, we use a simplified calculation with average UK growth rates.
 * 
 * In production, this could be enhanced to fetch live data from ONS API:
 * https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/housepriceindexmonthlyquarterlytables
 */

// Regional annual growth rates (approximate UK averages)
const REGION_ANNUAL_GROWTH: Record<string, number> = {
  E12000001: 0.02, // North East - lower growth
  E12000002: 0.035, // North West
  E12000003: 0.03, // Yorkshire and The Humber
  E12000004: 0.04, // East Midlands
  E12000005: 0.035, // West Midlands
  E12000006: 0.045, // East of England
  E12000007: 0.03, // London - slower recent growth
  E12000008: 0.04, // South East
  E12000009: 0.045, // South West
  W92000004: 0.05, // Wales - higher recent growth
  DEFAULT: 0.04, // UK average ~4%
};

/**
 * Calculate the adjustment factor for a sale price based on time elapsed
 */
export function getHPIAdjustmentFactor(
  saleDate: string,
  currentDate: string = new Date().toISOString(),
  regionCode: string = 'DEFAULT'
): number {
  const saleTime = new Date(saleDate).getTime();
  const currentTime = new Date(currentDate).getTime();

  // Calculate years difference (can be fractional)
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
  const yearsDiff = (currentTime - saleTime) / msPerYear;

  // Don't adjust future dates or very recent sales
  if (yearsDiff <= 0.1) {
    return 1.0;
  }

  // Get regional growth rate, fallback to default
  const annualGrowth = REGION_ANNUAL_GROWTH[regionCode] ?? REGION_ANNUAL_GROWTH['DEFAULT'];

  // Compound growth formula
  const factor = Math.pow(1 + annualGrowth, yearsDiff);

  logger.debug('HPI adjustment calculated', {
    saleDate,
    yearsDiff: yearsDiff.toFixed(2),
    annualGrowth,
    factor: factor.toFixed(4),
  });

  return factor;
}

/**
 * Adjust a historical sale price to present-day value
 */
export function adjustPriceToPresent(
  price: number,
  saleDate: string,
  regionCode: string = 'DEFAULT'
): number {
  const factor = getHPIAdjustmentFactor(saleDate, undefined, regionCode);
  return Math.round(price * factor);
}

/**
 * Real health check - verifies HPI calculation works correctly
 * Tests with known inputs and validates output is within expected range
 */
export async function healthCheck(): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    // Test with a date 2 years ago - should have ~8% adjustment at 4% annual rate
    const testDate = new Date();
    testDate.setFullYear(testDate.getFullYear() - 2);
    const testDateStr = testDate.toISOString();

    const factor = getHPIAdjustmentFactor(testDateStr);
    const latencyMs = Date.now() - start;

    // Validate the calculation produces reasonable results
    // 2 years at 4% should be approximately 1.0816 (1.04^2)
    const expectedMin = 1.06;
    const expectedMax = 1.12;

    if (factor >= expectedMin && factor <= expectedMax) {
      logger.info('ONS HPI health check passed', { factor, testDate: testDateStr });
      return { ok: true, latencyMs };
    }

    return {
      ok: false,
      latencyMs,
      error: `HPI calculation out of expected range: ${factor.toFixed(4)} (expected ${expectedMin}-${expectedMax})`,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return { ok: false, latencyMs, error: (err as Error).message };
  }
}
