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

export function findAddressMatch(
  addresses: IdealPostcodesAddress[],
  addressLine1: string
): IdealPostcodesAddress | null {
  const normalizedInput = addressLine1.toLowerCase().trim();

  // Try exact match on line_1 first
  const exactMatch = addresses.find((addr) => {
    const line1Lower = addr.line_1.toLowerCase().trim();
    return line1Lower === normalizedInput;
  });

  if (exactMatch) return exactMatch;

  // Try building number + thoroughfare match
  const buildingMatch = addresses.find((addr) => {
    const fullLine = `${addr.building_number} ${addr.thoroughfare}`.toLowerCase().trim();
    return fullLine === normalizedInput;
  });

  if (buildingMatch) return buildingMatch;

  // Try partial/contains match
  const partialMatch = addresses.find((addr) => {
    const line1Lower = addr.line_1.toLowerCase();
    return line1Lower.includes(normalizedInput) || normalizedInput.includes(line1Lower);
  });

  return partialMatch || null;
}

export async function healthCheck(origin?: string): Promise<HealthCheckResult> {
  const start = Date.now();
  const testPostcode = 'SW1A1AA'; // Buckingham Palace - always valid

  const result = await lookupPostcode(testPostcode, origin);
  const latencyMs = Date.now() - start;

  if (result.success) {
    return { ok: true, latencyMs };
  }

  return { ok: false, latencyMs, error: result.error };
}
