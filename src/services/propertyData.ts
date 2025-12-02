import { httpRequest } from '../utils/httpClient';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import type { HealthCheckResult } from '../types/services';

const BASE_URL = config.urls.propertyData;

// PropertyData API has slower response times (~2-4 seconds)
// Use extended timeout to accommodate their processing time
const PROPERTYDATA_TIMEOUT = 5000; // 5 seconds for reliability

// PropertyData API response types
export interface PropertyDataPricePoint {
  price: number;
  lat: string;
  lng: string;
  bedrooms: number;
  type: string;
  distance: string;
  sstc: number;
  portal: string;
}

export interface PropertyDataPricesResponse {
  status: string;
  postcode: string;
  postcode_type: string;
  url: string;
  bedrooms: number;
  data: {
    points_analysed: number;
    radius: string;
    average: number;
    '70pc_range': [number, number];
    '80pc_range': [number, number];
    '90pc_range': [number, number];
    '100pc_range': [number, number];
    raw_data: PropertyDataPricePoint[];
  };
  process_time: string;
}

export interface PropertyDataSoldPrice {
  price: number;
  date: string;
  address: string;
  postcode: string;
  type: string;
  lat: string;
  lng: string;
  distance: string;
}

export interface PropertyDataSoldPricesResponse {
  status: string;
  postcode: string;
  data: PropertyDataSoldPrice[];
  process_time: string;
}

export type PricesResult =
  | { success: true; data: PropertyDataPricesResponse }
  | { success: false; error: string };

export type SoldPricesResult =
  | { success: true; sales: PropertyDataSoldPrice[] }
  | { success: false; error: string };

/**
 * Get current property prices/listings for a postcode
 * Uses the /prices endpoint
 */
export async function getPrices(
  postcode: string,
  bedrooms?: number
): Promise<PricesResult> {
  const cleanPostcode = postcode.replace(/\s/g, '+');
  let url = `${BASE_URL}/prices?key=${config.propertyDataApiKey}&postcode=${cleanPostcode}`;
  
  if (bedrooms) {
    url += `&bedrooms=${bedrooms}`;
  }

  logger.info('Fetching prices via PropertyData', { postcode: cleanPostcode, bedrooms });

  const result = await httpRequest<PropertyDataPricesResponse>(url, {
    timeout: PROPERTYDATA_TIMEOUT,
  });

  if (!result.success) {
    return { success: false, error: result.error.message };
  }

  if (result.response.data.status !== 'success') {
    return { success: false, error: 'Failed to fetch property prices' };
  }

  return { success: true, data: result.response.data };
}

/**
 * Get sold property prices (Land Registry data) for a postcode
 * Uses the /sold-prices endpoint
 */
export async function getSoldPrices(
  postcode: string,
  maxAge?: number
): Promise<SoldPricesResult> {
  const cleanPostcode = postcode.replace(/\s/g, '+');
  let url = `${BASE_URL}/sold-prices?key=${config.propertyDataApiKey}&postcode=${cleanPostcode}`;
  
  if (maxAge) {
    url += `&max_age=${maxAge}`;
  }

  logger.info('Fetching sold prices via PropertyData', { postcode: cleanPostcode, maxAge });

  const result = await httpRequest<PropertyDataSoldPricesResponse>(url, {
    timeout: PROPERTYDATA_TIMEOUT,
  });

  if (!result.success) {
    return { success: false, error: result.error.message };
  }

  if (result.response.data.status !== 'success') {
    return { success: false, error: 'Failed to fetch sold prices' };
  }

  return { success: true, sales: result.response.data.data || [] };
}

/**
 * Health check for PropertyData API
 * Verifies /prices endpoint returns actual property data
 * No shortcuts - must get real results
 */
export async function healthCheck(): Promise<HealthCheckResult> {
  const start = Date.now();
  // Use known working postcode that returns data
  const testPostcode = 'W14 9JH';

  const url = `${BASE_URL}/prices?key=${config.propertyDataApiKey}&postcode=${testPostcode.replace(/\s/g, '+')}`;
  
  logger.info('PropertyData health check', { postcode: testPostcode });
  
  const result = await httpRequest<PropertyDataPricesResponse>(url, {
    timeout: PROPERTYDATA_TIMEOUT,
  });
  const latencyMs = Date.now() - start;

  // Must have successful HTTP response
  if (!result.success) {
    logger.error('PropertyData health check failed - HTTP error', { error: result.error.message });
    return { ok: false, latencyMs, error: result.error.message };
  }

  // Must have successful API status
  const data = result.response.data;
  if (data.status !== 'success') {
    logger.error('PropertyData health check failed - API returned non-success', { status: data.status });
    return { ok: false, latencyMs, error: `PropertyData API returned status: ${data.status}` };
  }

  // Verify we got actual data back
  if (!data.data) {
    logger.error('PropertyData health check failed - no data returned');
    return { ok: false, latencyMs, error: 'PropertyData API returned no data' };
  }

  logger.info('PropertyData health check passed', { 
    postcode: testPostcode,
    pointsAnalysed: data.data.points_analysed 
  });
    
  return { ok: true, latencyMs };
}
