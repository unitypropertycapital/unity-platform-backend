import { getSoldPrices, PropertyDataSoldPrice } from './propertyData';
import { logger } from '../utils/logger';
import type { HealthCheckResult } from '../types/services';

export interface LandRegistrySale {
  address: string;
  postcode: string;
  price: number;
  date: string;
  propertyType: string;
  latitude: number;
  longitude: number;
  distanceMiles: number;
  source: 'LR';
}

export type LandRegistryResult =
  | { success: true; sales: LandRegistrySale[] }
  | { success: false; error: string };

/**
 * Map PropertyData sold price to our LandRegistrySale format
 */
function mapToLandRegistrySale(sale: PropertyDataSoldPrice): LandRegistrySale {
  return {
    address: sale.address,
    postcode: sale.postcode,
    price: sale.price,
    date: sale.date,
    propertyType: sale.type,
    latitude: parseFloat(sale.lat),
    longitude: parseFloat(sale.lng),
    distanceMiles: parseFloat(sale.distance),
    source: 'LR',
  };
}

/**
 * Get Land Registry sold prices for a postcode
 * Uses PropertyData's /sold-prices endpoint which provides LR data
 */
export async function getSales(
  postcode: string,
  maxAgeMonths: number = 24
): Promise<LandRegistryResult> {
  logger.info('Fetching Land Registry sales', { postcode, maxAgeMonths });

  const result = await getSoldPrices(postcode, maxAgeMonths);

  if (!result.success) {
    return { success: false, error: result.error };
  }

  const sales = result.sales.map(mapToLandRegistrySale);

  logger.info('Land Registry sales fetched', {
    postcode,
    count: sales.length,
  });

  return { success: true, sales };
}

/**
 * Real health check - actually calls sold-prices endpoint
 */
export async function healthCheck(): Promise<HealthCheckResult> {
  const start = Date.now();
  const testPostcode = 'W14 9JH';

  logger.info('Land Registry health check', { postcode: testPostcode });

  const result = await getSoldPrices(testPostcode);
  const latencyMs = Date.now() - start;

  if (result.success) {
    return { ok: true, latencyMs };
  }

  return { ok: false, latencyMs, error: result.error };
}
