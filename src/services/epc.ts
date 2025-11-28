import { httpRequest } from '../utils/httpClient';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import type { HealthCheckResult } from '../types/services';

const BASE_URL = config.urls.propertyData;

// PropertyData API has slower response times (~2 seconds)
const PROPERTYDATA_TIMEOUT = 3000; // 3 seconds

// EPC data structure
export interface EPCData {
  floorAreaSqm: number;
  propertyType: string;
  builtForm: string;
  currentRating: string;
  inspectionDate: string;
}

export interface PropertyDataEPCResponse {
  status: string;
  uprn?: string;
  address?: string;
  postcode?: string;
  data?: {
    total_floor_area?: number;
    property_type?: string;
    built_form?: string;
    current_energy_rating?: string;
    lodgement_date?: string;
  };
}

export type EPCLookupResult =
  | { success: true; data: EPCData }
  | { success: false; error: string };

/**
 * Get floor area from EPC data
 * Tries UPRN first, then falls back to postcode/address search
 */
export async function getFloorArea(
  uprn: string | null,
  postcode: string,
  addressLine1: string
): Promise<EPCLookupResult> {
  logger.info('Fetching EPC floor area', { uprn, postcode, addressLine1 });

  // Try UPRN lookup first (more accurate)
  if (uprn) {
    const uprnResult = await getEPCByUPRN(uprn);
    if (uprnResult.success) {
      return uprnResult;
    }
    logger.warn('UPRN-based EPC lookup failed, trying postcode', {
      uprn,
      error: uprnResult.error,
    });
  }

  // Fallback to postcode lookup
  const postcodeResult = await getEPCByPostcode(postcode);
  if (postcodeResult.success) {
    return postcodeResult;
  }

  // EPC data not available - this is not a critical failure
  return { success: false, error: 'EPC data not available for this property' };
}

/**
 * Get EPC data by UPRN
 */
async function getEPCByUPRN(uprn: string): Promise<EPCLookupResult> {
  const url = `${BASE_URL}/epc?key=${config.propertyDataApiKey}&uprn=${uprn}`;

  logger.info('Fetching EPC by UPRN', { uprn });

  const result = await httpRequest<PropertyDataEPCResponse>(url, {
    timeout: PROPERTYDATA_TIMEOUT,
  });

  if (!result.success) {
    return { success: false, error: result.error.message };
  }

  const data = result.response.data;
  if (data.status !== 'success' || !data.data?.total_floor_area) {
    return { success: false, error: 'No EPC data found for this UPRN' };
  }

  return {
    success: true,
    data: {
      floorAreaSqm: data.data.total_floor_area,
      propertyType: data.data.property_type || 'unknown',
      builtForm: data.data.built_form || 'unknown',
      currentRating: data.data.current_energy_rating || 'unknown',
      inspectionDate: data.data.lodgement_date || 'unknown',
    },
  };
}

/**
 * Get EPC data by postcode
 */
async function getEPCByPostcode(postcode: string): Promise<EPCLookupResult> {
  const cleanPostcode = postcode.replace(/\s/g, '+');
  const url = `${BASE_URL}/epc?key=${config.propertyDataApiKey}&postcode=${cleanPostcode}`;

  logger.info('Fetching EPC by postcode', { postcode: cleanPostcode });

  const result = await httpRequest<PropertyDataEPCResponse>(url, {
    timeout: PROPERTYDATA_TIMEOUT,
  });

  if (!result.success) {
    return { success: false, error: result.error.message };
  }

  const data = result.response.data;
  if (data.status !== 'success' || !data.data?.total_floor_area) {
    return { success: false, error: 'No EPC data found for this postcode' };
  }

  return {
    success: true,
    data: {
      floorAreaSqm: data.data.total_floor_area,
      propertyType: data.data.property_type || 'unknown',
      builtForm: data.data.built_form || 'unknown',
      currentRating: data.data.current_energy_rating || 'unknown',
      inspectionDate: data.data.lodgement_date || 'unknown',
    },
  };
}

/**
 * Real health check - actually calls EPC endpoint
 * Note: Uses PropertyData API which has ~2s response time
 */
export async function healthCheck(): Promise<HealthCheckResult> {
  const start = Date.now();
  const testPostcode = 'W14+9JH';
  
  const url = `${BASE_URL}/epc?key=${config.propertyDataApiKey}&postcode=${testPostcode}`;
  
  logger.info('EPC health check', { postcode: testPostcode });
  
  const result = await httpRequest<PropertyDataEPCResponse>(url, {
    timeout: PROPERTYDATA_TIMEOUT,
  });
  const latencyMs = Date.now() - start;

  if (result.success) {
    return { ok: true, latencyMs };
  }

  return { ok: false, latencyMs, error: result.error.message };
}
