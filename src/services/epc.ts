import { httpRequest } from '../utils/httpClient';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import type { HealthCheckResult } from '../types/services';

const BASE_URL = config.urls.propertyData;

// PropertyData API has slower response times (~2-4 seconds)
const PROPERTYDATA_TIMEOUT = 5000; // 5 seconds for reliability

// EPC data structure (what we return)
export interface EPCData {
  floorAreaSqm: number | null;
  propertyType: string;
  builtForm: string;
  currentRating: string;
  score: number;
  inspectionDate: string;
  address: string;
}

// PropertyData energy-efficiency API response (postcode lookup)
interface EnergyEfficiencyRecord {
  inspection_date: string;
  address: string;
  score: number;
  rating: string;
}

interface PropertyDataEnergyEfficiencyResponse {
  status: string;
  postcode?: string;
  energy_efficiency?: EnergyEfficiencyRecord[];
}

// PropertyData energy-efficiency API response (UPRN lookup - different structure)
interface PropertyDataUPRNResponse {
  status: string;
  uprn?: string;
  address?: string;
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
 * Get EPC data for a property
 * Tries UPRN first (more detailed), then falls back to postcode/address matching
 */
export async function getFloorArea(
  uprn: string | null,
  postcode: string,
  addressLine1: string
): Promise<EPCLookupResult> {
  logger.info('Fetching EPC floor area', { uprn, postcode, addressLine1 });

  // Try UPRN lookup first (returns floor area)
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

  // Fallback to postcode lookup with address matching
  const postcodeResult = await getEPCByPostcode(postcode, addressLine1);
  if (postcodeResult.success) {
    return postcodeResult;
  }

  return { success: false, error: 'EPC data not available for this property' };
}

/**
 * Get EPC data by UPRN (returns floor area if available)
 */
async function getEPCByUPRN(uprn: string): Promise<EPCLookupResult> {
  const url = `${BASE_URL}/energy-efficiency?key=${config.propertyDataApiKey}&uprn=${uprn}`;

  logger.info('Fetching EPC by UPRN', { uprn });

  const result = await httpRequest<PropertyDataUPRNResponse>(url, {
    timeout: PROPERTYDATA_TIMEOUT,
  });

  if (!result.success) {
    return { success: false, error: result.error.message };
  }

  const response = result.response.data;
  if (response.status !== 'success' || !response.data) {
    return { success: false, error: 'No EPC data found for this UPRN' };
  }

  return {
    success: true,
    data: {
      floorAreaSqm: response.data.total_floor_area || null,
      propertyType: response.data.property_type || 'unknown',
      builtForm: response.data.built_form || 'unknown',
      currentRating: response.data.current_energy_rating || 'unknown',
      score: 0, // UPRN response doesn't include score
      inspectionDate: response.data.lodgement_date || 'unknown',
      address: response.address || 'unknown',
    },
  };
}

/**
 * Get EPC data by postcode with address matching
 * Returns the best matching EPC record
 */
async function getEPCByPostcode(
  postcode: string,
  addressLine1: string
): Promise<EPCLookupResult> {
  const cleanPostcode = postcode.replace(/\s/g, '+');
  const url = `${BASE_URL}/energy-efficiency?key=${config.propertyDataApiKey}&postcode=${cleanPostcode}`;

  logger.info('Fetching EPC by postcode', { postcode: cleanPostcode, addressLine1 });

  const result = await httpRequest<PropertyDataEnergyEfficiencyResponse>(url, {
    timeout: PROPERTYDATA_TIMEOUT,
  });

  if (!result.success) {
    return { success: false, error: result.error.message };
  }

  const response = result.response.data;
  if (response.status !== 'success' || !response.energy_efficiency?.length) {
    return { success: false, error: 'No EPC data found for this postcode' };
  }

  // Try to find the best matching address
  const records = response.energy_efficiency;
  const matchedRecord = findBestAddressMatch(records, addressLine1);

  if (!matchedRecord) {
    // No match found, use the most recent record
    const mostRecent = records[0]; // API returns sorted by date descending
    logger.info('No exact EPC match, using most recent record', {
      address: mostRecent.address,
      rating: mostRecent.rating,
    });

    return {
      success: true,
      data: {
        floorAreaSqm: null, // Postcode lookup doesn't return floor area
        propertyType: 'unknown',
        builtForm: 'unknown',
        currentRating: mostRecent.rating,
        score: mostRecent.score,
        inspectionDate: mostRecent.inspection_date,
        address: mostRecent.address,
      },
    };
  }

  logger.info('EPC match found', {
    address: matchedRecord.address,
    rating: matchedRecord.rating,
    score: matchedRecord.score,
  });

  return {
    success: true,
    data: {
      floorAreaSqm: null, // Postcode lookup doesn't return floor area
      propertyType: 'unknown',
      builtForm: 'unknown',
      currentRating: matchedRecord.rating,
      score: matchedRecord.score,
      inspectionDate: matchedRecord.inspection_date,
      address: matchedRecord.address,
    },
  };
}

/**
 * Find the best matching EPC record for an address
 */
function findBestAddressMatch(
  records: EnergyEfficiencyRecord[],
  addressLine1: string
): EnergyEfficiencyRecord | null {
  const normalizedInput = addressLine1.toLowerCase().trim();

  // Extract building number from input
  const inputNumber = extractBuildingNumber(normalizedInput);

  // Try exact match first
  const exactMatch = records.find((r) => {
    const recordAddr = r.address.toLowerCase();
    return recordAddr.includes(normalizedInput) || normalizedInput.includes(recordAddr);
  });

  if (exactMatch) return exactMatch;

  // Try building number match
  if (inputNumber) {
    const numberMatch = records.find((r) => {
      const recordNumber = extractBuildingNumber(r.address.toLowerCase());
      return recordNumber === inputNumber;
    });
    if (numberMatch) return numberMatch;
  }

  return null;
}

/**
 * Extract building number from address
 */
function extractBuildingNumber(address: string): string | null {
  // Match patterns like "36", "36a", "Flat 4", etc.
  const patterns = [
    /^(\d+[a-z]?)\s/i, // "36 Charleville Road"
    /^flat\s+(\d+)/i, // "Flat 4"
    /,\s*(\d+)\s/i, // ", 36 Charleville"
  ];

  for (const pattern of patterns) {
    const match = address.match(pattern);
    if (match) return match[1].toLowerCase();
  }

  return null;
}

/**
 * Health check for EPC/Energy-Efficiency endpoint
 */
export async function healthCheck(): Promise<HealthCheckResult> {
  const start = Date.now();
  const testPostcode = 'W14 9JH';

  const url = `${BASE_URL}/energy-efficiency?key=${config.propertyDataApiKey}&postcode=${testPostcode.replace(/\s/g, '+')}`;

  logger.info('EPC health check', { postcode: testPostcode });

  const result = await httpRequest<PropertyDataEnergyEfficiencyResponse>(url, {
    timeout: PROPERTYDATA_TIMEOUT,
  });
  const latencyMs = Date.now() - start;

  if (!result.success) {
    logger.error('EPC health check failed - HTTP error', { error: result.error.message });
    return { ok: false, latencyMs, error: result.error.message };
  }

  const response = result.response.data;
  if (response.status !== 'success') {
    logger.error('EPC health check failed - API returned non-success', { status: response.status });
    return { ok: false, latencyMs, error: `EPC API returned status: ${response.status}` };
  }

  // Verify we got EPC records
  const recordCount = response.energy_efficiency?.length || 0;
  if (recordCount === 0) {
    logger.error('EPC health check failed - no records returned');
    return { ok: false, latencyMs, error: 'No EPC records returned' };
  }

  logger.info('EPC health check passed', {
    postcode: testPostcode,
    recordCount,
    firstRating: response.energy_efficiency?.[0]?.rating,
  });

  return { ok: true, latencyMs };
}
