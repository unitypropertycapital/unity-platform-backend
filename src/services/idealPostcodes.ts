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
  const match = address.match(/^(\d+[a-zA-Z]?)\s/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Find matching address from list of addresses
 * Uses multiple matching strategies for flexibility
 */
export function findAddressMatch(
  addresses: IdealPostcodesAddress[],
  addressLine1: string
): IdealPostcodesAddress | null {
  const normalizedInput = addressLine1.toLowerCase().trim();
  const inputBuildingNum = extractBuildingNumber(normalizedInput);

  // Strategy 1: Exact match on line_1
  const exactMatch = addresses.find((addr) => {
    const line1Lower = addr.line_1.toLowerCase().trim();
    return line1Lower === normalizedInput;
  });
  if (exactMatch) return exactMatch;

  // Strategy 2: Building number + thoroughfare match
  const buildingMatch = addresses.find((addr) => {
    const fullLine = `${addr.building_number} ${addr.thoroughfare}`.toLowerCase().trim();
    return fullLine === normalizedInput;
  });
  if (buildingMatch) return buildingMatch;

  // Strategy 3: Match by building number only (if unique)
  if (inputBuildingNum) {
    const numberMatches = addresses.filter((addr) => {
      return addr.building_number?.toLowerCase() === inputBuildingNum;
    });
    if (numberMatches.length === 1) return numberMatches[0];
  }

  // Strategy 4: Partial/contains match on line_1
  const partialMatch = addresses.find((addr) => {
    const line1Lower = addr.line_1.toLowerCase();
    return line1Lower.includes(normalizedInput) || normalizedInput.includes(line1Lower);
  });
  if (partialMatch) return partialMatch;

  // Strategy 5: Match building number with street name containing input
  if (inputBuildingNum) {
    const streetMatch = addresses.find((addr) => {
      const hasMatchingNumber = addr.building_number?.toLowerCase() === inputBuildingNum;
      const inputStreet = normalizedInput.replace(/^\d+[a-zA-Z]?\s*/, '').trim();
      const addrStreet = addr.thoroughfare?.toLowerCase() || '';
      return hasMatchingNumber && (addrStreet.includes(inputStreet) || inputStreet.includes(addrStreet));
    });
    if (streetMatch) return streetMatch;
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
