import { httpRequest } from '../utils/httpClient';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import type { HealthCheckResult } from '../types/services';

const BASE_URL = config.urls.propertyData;

// PropertyData API has slower response times (~2 seconds)
// Use extended timeout to accommodate their processing time
const PROPERTYDATA_TIMEOUT = 3000; // 3 seconds

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
 * Uses /prices endpoint which is confirmed working
 * Note: PropertyData API has ~2s response time, using extended timeout
 */
export async function healthCheck(): Promise<HealthCheckResult> {
  const start = Date.now();
  const testPostcode = 'W14 9JH'; // Known working postcode from their test

  const url = `${BASE_URL}/prices?key=${config.propertyDataApiKey}&postcode=${testPostcode.replace(/\s/g, '+')}`;
  
  logger.info('PropertyData health check', { postcode: testPostcode });
  
  const result = await httpRequest<PropertyDataPricesResponse>(url, {
    timeout: PROPERTYDATA_TIMEOUT,
  });
  const latencyMs = Date.now() - start;

  if (result.success && result.response.data.status === 'success') {
    return { ok: true, latencyMs };
  }

  const errorMessage = result.success 
    ? 'API returned non-success status' 
    : result.error.message;
    
  return { ok: false, latencyMs, error: errorMessage };
}
