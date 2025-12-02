import type { VercelRequest, VercelResponse } from '@vercel/node';
import { logger } from '../../src/utils/logger';
import { getRequestOrigin } from '../../src/utils/requestOrigin';
import { handleError, getStatusCode } from '../../src/utils/errors';
import { validateAddressResolveRequest } from '../../src/types/address';
import {
  findCachedAddress,
  cacheAddress,
  mapIdealPostcodesToAddressData,
} from '../../src/services/addressCache';
import { lookupPostcode, findAddressMatch } from '../../src/services/idealPostcodes';
import type { CachedAddress, AddressResolveResponse } from '../../src/types/address';

/**
 * Convert CachedAddress to API response (excluding provider_raw for brevity)
 */
function toResponse(address: CachedAddress): AddressResolveResponse {
  return {
    id: address.id,
    postcode: address.postcode,
    house_number: address.house_number,
    address_line_1: address.address_line_1,
    address_line_2: address.address_line_2,
    town: address.town,
    county: address.county,
    country: address.country,
    uprn: address.uprn,
    udprn: address.udprn,
    latitude: address.latitude,
    longitude: address.longitude,
    created_at: address.created_at,
    updated_at: address.updated_at,
  };
}

/**
 * Resolve address from Ideal Postcodes and cache it
 */
async function resolveAndCache(
  postcode: string,
  houseNumber: string,
  origin: string
): Promise<{ success: true; address: CachedAddress } | { success: false; error: string }> {
  logger.info('Resolving address via Ideal Postcodes', { postcode, houseNumber });

  // Call Ideal Postcodes (this is the ONLY place in the system that calls it)
  const postcodeResult = await lookupPostcode(postcode, origin);

  if (!postcodeResult.success) {
    logger.error('Ideal Postcodes lookup failed', { error: postcodeResult.error });
    return { success: false, error: `Ideal Postcodes error: ${postcodeResult.error}` };
  }

  if (postcodeResult.addresses.length === 0) {
    return { success: false, error: 'No addresses found for this postcode' };
  }

  // Find matching address by house number
  const matchedAddress = findAddressMatch(postcodeResult.addresses, houseNumber);

  if (!matchedAddress) {
    logger.warn('No matching address found', {
      houseNumber,
      availableCount: postcodeResult.addresses.length,
    });
    return {
      success: false,
      error: `Could not match house number "${houseNumber}" to any address at ${postcode}`,
    };
  }

  // Map to cache format
  const addressData = mapIdealPostcodesToAddressData(
    matchedAddress,
    postcode,
    houseNumber,
    matchedAddress as unknown as Record<string, unknown>
  );

  // Cache the address
  const cached = await cacheAddress(addressData);

  if (!cached) {
    return { success: false, error: 'Failed to cache address' };
  }

  logger.info('Address resolved and cached', { id: cached.id, uprn: cached.uprn });
  return { success: true, address: cached };
}

/**
 * POST /api/address/resolve
 *
 * The ONLY endpoint that calls Ideal Postcodes.
 * Caches results in Supabase to avoid duplicate API calls.
 *
 * Request: { postcode: string, houseNumber: string, town?: string }
 * Response: CachedAddress row
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const origin = getRequestOrigin(req);
  logger.info('Address resolve request received', { origin });

  // Validate request
  const validation = validateAddressResolveRequest(req.body);

  if (!validation.valid) {
    logger.warn('Invalid address resolve request', { errors: validation.errors });
    res.status(400).json({ error: 'Invalid request', details: validation.errors });
    return;
  }

  const { postcode, houseNumber } = validation;

  try {
    // Step 1: Check cache first
    const cached = await findCachedAddress(postcode, houseNumber);

    if (cached) {
      logger.info('Returning cached address (no Ideal Postcodes call)', { id: cached.id });
      res.status(200).json(toResponse(cached));
      return;
    }

    // Step 2: Not in cache, resolve via Ideal Postcodes
    const result = await resolveAndCache(postcode, houseNumber, origin);

    if (!result.success) {
      res.status(404).json({ error: result.error });
      return;
    }

    res.status(200).json(toResponse(result.address));
  } catch (err) {
    const errorResponse = handleError(err, { endpoint: '/api/address/resolve', origin });
    const statusCode = getStatusCode(err);
    res.status(statusCode).json(errorResponse);
  }
}
