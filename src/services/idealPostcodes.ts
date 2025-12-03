import { httpRequest } from '../utils/httpClient';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import type {
  IdealPostcodesResponse,
  IdealPostcodesAddress,
  IdealPostcodesUPRNResponse,
  HealthCheckResult,
} from '../types/services';

const BASE_URL = config.urls.idealPostcodes;

export type AddressLookupResult =
  | { success: true; addresses: IdealPostcodesAddress[] }
  | { success: false; error: string };

export type UPRNLookupResult =
  | { success: true; address: IdealPostcodesAddress }
  | { success: false; error: string };

/**
 * Build headers for Ideal Postcodes requests
 * Includes Origin header if provided (for URL whitelist verification)
 */
function buildHeaders(origin?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (origin) {
    headers['Origin'] = origin;
  }
  return headers;
}

export async function lookupPostcode(
  postcode: string,
  origin?: string
): Promise<AddressLookupResult> {
  const cleanPostcode = postcode.replace(/\s/g, '').toUpperCase();
  const url = `${BASE_URL}/postcodes/${cleanPostcode}?api_key=${config.idealPostcodesApiKey}`;

  logger.info('Looking up postcode via Ideal Postcodes', { postcode: cleanPostcode });

  const result = await httpRequest<IdealPostcodesResponse>(url, {
    headers: buildHeaders(origin),
  });

  if (!result.success) {
    return { success: false, error: result.error.message };
  }

  if (result.response.data.code !== 2000) {
    return { success: false, error: result.response.data.message };
  }

  return { success: true, addresses: result.response.data.result };
}

export async function lookupUPRN(
  uprn: string,
  origin?: string
): Promise<UPRNLookupResult> {
  const url = `${BASE_URL}/uprns/${uprn}?api_key=${config.idealPostcodesApiKey}`;

  logger.info('Looking up UPRN via Ideal Postcodes', { uprn });

  const result = await httpRequest<IdealPostcodesUPRNResponse>(url, {
    headers: buildHeaders(origin),
  });

  if (!result.success) {
    return { success: false, error: result.error.message };
  }

  if (result.response.data.code !== 2000) {
    return { success: false, error: result.response.data.message };
  }

  return { success: true, address: result.response.data.result };
}

/**
 * Extract building number from address string
 */
function extractBuildingNumber(address: string): string | null {
  // Match number at start (with optional letter suffix) or just a pure number
  const match = address.match(/^(\d+[a-zA-Z]?)\s/) || address.match(/^(\d+[a-zA-Z]?)$/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Normalize house number for comparison (lowercase, trimmed)
 */
function normalizeHouseNum(num: string | undefined | null): string {
  return (num || '').toLowerCase().trim();
}

/**
 * Find matching address from list of addresses
 * Uses multiple matching strategies for flexibility
 * 
 * @param addresses - List of addresses from Ideal Postcodes
 * @param houseNumberOrAddress - Either just "36" or full "36 Charleville Road"
 */
export function findAddressMatch(
  addresses: IdealPostcodesAddress[],
  houseNumberOrAddress: string
): IdealPostcodesAddress | null {
  const normalizedInput = houseNumberOrAddress.toLowerCase().trim();
  const inputBuildingNum = extractBuildingNumber(normalizedInput);
  
  // Check if input is JUST a house number (no street name)
  const isJustHouseNumber = /^\d+[a-zA-Z]?$/.test(normalizedInput);

  // Strategy 1: Direct building_number match (most common for house number lookups)
  if (isJustHouseNumber || inputBuildingNum) {
    const targetNum = normalizeHouseNum(isJustHouseNumber ? normalizedInput : inputBuildingNum);
    
    // Match by building_number field
    const buildingNumMatches = addresses.filter((addr) => {
      return normalizeHouseNum(addr.building_number) === targetNum;
    });
    if (buildingNumMatches.length === 1) return buildingNumMatches[0];
    if (buildingNumMatches.length > 1) {
      // Multiple matches - return first residential one, or just first
      return buildingNumMatches[0];
    }

    // Match by line_1 starting with the number
    const line1Match = addresses.find((addr) => {
      const line1 = addr.line_1.toLowerCase();
      return line1.startsWith(targetNum + ' ') || line1.startsWith(targetNum + ',');
    });
    if (line1Match) return line1Match;
    
    // Match by building_name containing the number
    const buildingNameMatch = addresses.find((addr) => {
      const name = (addr.building_name || '').toLowerCase();
      return name.includes(targetNum) || name.startsWith(targetNum);
    });
    if (buildingNameMatch) return buildingNameMatch;
  }

  // Strategy 2: Exact match on line_1 (for full address input)
  const exactMatch = addresses.find((addr) => {
    const line1Lower = addr.line_1.toLowerCase().trim();
    return line1Lower === normalizedInput;
  });
  if (exactMatch) return exactMatch;

  // Strategy 3: Building number + thoroughfare match
  const buildingMatch = addresses.find((addr) => {
    const fullLine = `${addr.building_number} ${addr.thoroughfare}`.toLowerCase().trim();
    return fullLine === normalizedInput;
  });
  if (buildingMatch) return buildingMatch;

  // Strategy 4: Partial/contains match on line_1
  const partialMatch = addresses.find((addr) => {
    const line1Lower = addr.line_1.toLowerCase();
    return line1Lower.includes(normalizedInput) || normalizedInput.includes(line1Lower);
  });
  if (partialMatch) return partialMatch;

  // Strategy 5: If nothing matches, return first address as fallback
  // (useful for single-property postcodes)
  if (addresses.length === 1) {
    return addresses[0];
  }

  return null;
}

/**
 * Validate Ideal Postcodes API key format
 * Keys typically start with 'ak_' and are 32-38 characters
 */
function isValidApiKeyFormat(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  // Ideal Postcodes keys start with 'ak_' or 'iddqd' (test key)
  return (key.startsWith('ak_') && key.length >= 20) || key === 'iddqd';
}

/**
 * Health check for Ideal Postcodes API (non-consuming)
 *
 * This health check verifies the API key is configured and valid format.
 * It does NOT make an API call to preserve credits.
 *
 * Real Ideal Postcodes connectivity is tested when /api/address/resolve is called.
 * Since all address lookups go through that endpoint, any issues will be caught there.
 */
export async function healthCheck(_origin?: string): Promise<HealthCheckResult> {
  const start = Date.now();

  logger.info('Ideal Postcodes health check (config validation only)');

  // Check if API key is configured
  if (!config.idealPostcodesApiKey) {
    logger.error('Ideal Postcodes API key not configured');
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: 'API key not configured',
    };
  }

  // Validate API key format
  if (!isValidApiKeyFormat(config.idealPostcodesApiKey)) {
    logger.error('Ideal Postcodes API key has invalid format');
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: 'API key has invalid format',
    };
  }

  logger.info('Ideal Postcodes health check passed (API key configured)');

  return {
    ok: true,
    latencyMs: Date.now() - start,
  };
}
