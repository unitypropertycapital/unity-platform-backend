import { httpRequest } from '../utils/httpClient';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import type { HealthCheckResult } from '../types/services';

const BASE_URL = config.urls.propertyData;

// PropertyData API has slower response times (~2-4 seconds)
const PROPERTYDATA_TIMEOUT = 5000; // 5 seconds for reliability

// Conversion factor: 1 sq ft = 0.092903 sq m
const SQ_FT_TO_SQ_M = 0.092903;

// EPC data structure (what we return)
export interface EPCData {
  floorAreaSqm: number | null;
  floorAreaSqFt: number | null;
  habitableRooms: number | null;
  propertyType: string;
  builtForm: string;
  currentRating: string;
  score: number;
  inspectionDate: string;
  address: string;
}

// PropertyData /energy-efficiency response (postcode lookup)
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

// PropertyData /floor-areas response
interface FloorAreaRecord {
  inspection_date: string;
  address: string;
  square_feet: number;
  habitable_rooms: number;
}

interface PropertyDataFloorAreasResponse {
  status: string;
  postcode?: string;
  known_floor_areas?: FloorAreaRecord[];
}

export type EPCLookupResult =
  | { success: true; data: EPCData }
  | { success: false; error: string };

/**
 * Get EPC data for a property including floor area
 * Fetches both energy-efficiency (rating) and floor-areas (sqft) endpoints
 */
export async function getFloorArea(
  uprn: string | null,
  postcode: string,
  addressLine1: string
): Promise<EPCLookupResult> {
  logger.info('Fetching EPC data', { uprn, postcode, addressLine1 });

  // Fetch both energy rating and floor area in parallel
  const [epcResult, floorAreaResult] = await Promise.all([
    getEPCByPostcode(postcode, addressLine1),
    getFloorAreaByPostcode(postcode, addressLine1),
  ]);

  // If both failed, return error
  if (!epcResult.success && !floorAreaResult.success) {
    return { success: false, error: 'EPC data not available for this property' };
  }

  // Merge the results - prioritize floor area data if available
  const epcData = epcResult.success ? epcResult.data : null;
  const floorData = floorAreaResult.success ? floorAreaResult.data : null;

  const mergedData: EPCData = {
    floorAreaSqm: floorData?.floorAreaSqm ?? null,
    floorAreaSqFt: floorData?.floorAreaSqFt ?? null,
    habitableRooms: floorData?.habitableRooms ?? null,
    propertyType: epcData?.propertyType || 'unknown',
    builtForm: epcData?.builtForm || 'unknown',
    currentRating: epcData?.currentRating || 'unknown',
    score: epcData?.score || 0,
    inspectionDate: floorData?.inspectionDate || epcData?.inspectionDate || 'unknown',
    address: floorData?.address || epcData?.address || 'unknown',
  };

  // Only return success if we have at least rating OR floor area
  if (mergedData.currentRating !== 'unknown' || mergedData.floorAreaSqm !== null) {
    logger.info('EPC data retrieved', {
      floorAreaSqm: mergedData.floorAreaSqm,
      rating: mergedData.currentRating,
      habitableRooms: mergedData.habitableRooms,
    });
    return { success: true, data: mergedData };
  }

  return { success: false, error: 'EPC data not available for this property' };
}

/**
 * Get EPC rating data by postcode with address matching
 */
async function getEPCByPostcode(
  postcode: string,
  addressLine1: string
): Promise<EPCLookupResult> {
  const cleanPostcode = postcode.replace(/\s/g, '+');
  const url = `${BASE_URL}/energy-efficiency?key=${config.propertyDataApiKey}&postcode=${cleanPostcode}`;

  logger.info('Fetching EPC rating by postcode', { postcode: cleanPostcode });

  const result = await httpRequest<PropertyDataEnergyEfficiencyResponse>(url, {
    timeout: PROPERTYDATA_TIMEOUT,
  });

  if (!result.success) {
    return { success: false, error: result.error.message };
  }

  const response = result.response.data;
  if (response.status !== 'success' || !response.energy_efficiency?.length) {
    return { success: false, error: 'No EPC rating data found' };
  }

  // Find best matching address
  const matchedRecord = findBestAddressMatch(response.energy_efficiency, addressLine1);

  const record = matchedRecord || response.energy_efficiency[0];

  return {
    success: true,
    data: {
      floorAreaSqm: null,
      floorAreaSqFt: null,
      habitableRooms: null,
      propertyType: 'unknown',
      builtForm: 'unknown',
      currentRating: record.rating,
      score: record.score,
      inspectionDate: record.inspection_date,
      address: record.address,
    },
  };
}

/**
 * Get floor area data by postcode with address matching
 */
async function getFloorAreaByPostcode(
  postcode: string,
  addressLine1: string
): Promise<EPCLookupResult> {
  const cleanPostcode = postcode.replace(/\s/g, '+');
  const url = `${BASE_URL}/floor-areas?key=${config.propertyDataApiKey}&postcode=${cleanPostcode}`;

  logger.info('Fetching floor area by postcode', { postcode: cleanPostcode });

  const result = await httpRequest<PropertyDataFloorAreasResponse>(url, {
    timeout: PROPERTYDATA_TIMEOUT,
  });

  if (!result.success) {
    return { success: false, error: result.error.message };
  }

  const response = result.response.data;
  if (response.status !== 'success' || !response.known_floor_areas?.length) {
    return { success: false, error: 'No floor area data found' };
  }

  // Find best matching address
  const matchedRecord = findBestAddressMatch(response.known_floor_areas, addressLine1);

  const record = matchedRecord || response.known_floor_areas[0];
  const floorAreaSqFt = record.square_feet;
  const floorAreaSqm = Math.round(floorAreaSqFt * SQ_FT_TO_SQ_M);

  logger.info('Floor area found', {
    address: record.address,
    sqft: floorAreaSqFt,
    sqm: floorAreaSqm,
    rooms: record.habitable_rooms,
  });

  return {
    success: true,
    data: {
      floorAreaSqm,
      floorAreaSqFt,
      habitableRooms: record.habitable_rooms,
      propertyType: 'unknown',
      builtForm: 'unknown',
      currentRating: 'unknown',
      score: 0,
      inspectionDate: record.inspection_date,
      address: record.address,
    },
  };
}

/**
 * Find the best matching record for an address
 */
function findBestAddressMatch<T extends { address: string }>(
  records: T[],
  addressLine1: string
): T | null {
  const normalizedInput = addressLine1.toLowerCase().trim();
  const inputNumber = extractBuildingNumber(normalizedInput);

  // Strategy 1: Exact/partial match on address
  const exactMatch = records.find((r) => {
    const recordAddr = r.address.toLowerCase();
    return recordAddr.includes(normalizedInput) || normalizedInput.includes(recordAddr);
  });
  if (exactMatch) return exactMatch;

  // Strategy 2: Building number match
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
  const patterns = [
    /^(\d+[a-z]?)\s/i, // "36 Charleville Road"
    /^flat\s+(\d+)/i, // "Flat 4"
    /,\s*(\d+)\s/i, // ", 36 Charleville"
    /(\d+),?\s+charleville/i, // "36 Charleville" or "36, Charleville"
  ];

  for (const pattern of patterns) {
    const match = address.match(pattern);
    if (match) return match[1].toLowerCase();
  }

  return null;
}

/**
 * Health check for EPC endpoints
 */
export async function healthCheck(): Promise<HealthCheckResult> {
  const start = Date.now();
  const testPostcode = 'W14 9JH';

  // Check both endpoints
  const [epcUrl, floorUrl] = [
    `${BASE_URL}/energy-efficiency?key=${config.propertyDataApiKey}&postcode=${testPostcode.replace(/\s/g, '+')}`,
    `${BASE_URL}/floor-areas?key=${config.propertyDataApiKey}&postcode=${testPostcode.replace(/\s/g, '+')}`,
  ];

  logger.info('EPC health check', { postcode: testPostcode });

  const [epcResult, floorResult] = await Promise.all([
    httpRequest<PropertyDataEnergyEfficiencyResponse>(epcUrl, { timeout: PROPERTYDATA_TIMEOUT }),
    httpRequest<PropertyDataFloorAreasResponse>(floorUrl, { timeout: PROPERTYDATA_TIMEOUT }),
  ]);

  const latencyMs = Date.now() - start;

  // Both must succeed for health check to pass
  if (!epcResult.success) {
    logger.error('EPC health check failed - energy-efficiency error', { error: epcResult.error.message });
    return { ok: false, latencyMs, error: epcResult.error.message };
  }

  if (!floorResult.success) {
    logger.error('EPC health check failed - floor-areas error', { error: floorResult.error.message });
    return { ok: false, latencyMs, error: floorResult.error.message };
  }

  // Verify we got data from both
  const epcCount = epcResult.response.data.energy_efficiency?.length || 0;
  const floorCount = floorResult.response.data.known_floor_areas?.length || 0;

  if (epcCount === 0 || floorCount === 0) {
    logger.error('EPC health check failed - no data returned', { epcCount, floorCount });
    return { ok: false, latencyMs, error: 'No EPC/floor area data returned' };
  }

  logger.info('EPC health check passed', {
    postcode: testPostcode,
    epcRecords: epcCount,
    floorRecords: floorCount,
  });

  return { ok: true, latencyMs };
}
