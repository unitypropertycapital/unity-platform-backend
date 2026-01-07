/**
 * POST /api/address/search
 * 
 * Search for addresses by postcode only
 * Returns a list of all addresses at the postcode for dropdown selection
 * 
 * Flow:
 * 1. Check postcode_lookups cache in Supabase
 * 2. If cached, return addresses (0 Ideal Postcodes API calls)
 * 3. If not cached, call Ideal Postcodes (1 API call) and cache result
 * 
 * Request: { postcode: string }
 * Response: { postcode, addresses: [], count, cached }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { lookupPostcode } from '../../src/services/idealPostcodes';
import { 
  findCachedPostcodeLookup, 
  cachePostcodeLookup 
} from '../../src/services/addressCache';
import { 
  validateAddressSearchRequest,
  type AddressSearchResponse,
  type AddressOption
} from '../../src/types/request';
import { logger } from '../../src/utils/logger';
import { handleError, getStatusCode } from '../../src/utils/errors';
import { getRequestOrigin } from '../../src/utils/requestOrigin';
import type { IdealPostcodesAddress } from '../../src/types/services';

/**
 * Format Ideal Postcodes address for frontend dropdown display
 */
function formatAddressForDisplay(address: IdealPostcodesAddress): string {
  const parts = [
    address.line_1,
    address.line_2,
    address.line_3,
    address.post_town,
  ].filter(Boolean);
  
  return parts.join(', ');
}

/**
 * Convert Ideal Postcodes address to AddressOption for frontend
 */
function toAddressOption(address: IdealPostcodesAddress): AddressOption {
  return {
    uprn: address.uprn || '',
    line_1: address.line_1 || '',
    line_2: address.line_2 || null,
    line_3: address.line_3 || null,
    town: address.post_town || '',
    county: null, // Ideal Postcodes doesn't provide county in response
    postcode: address.postcode || '',
    display: formatAddressForDisplay(address),
  };
}

/**
 * Main handler for address search endpoint
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
  logger.info('Address search request received', { origin });

  // Validate request
  const validation = validateAddressSearchRequest(req.body);

  if (!validation.valid) {
    logger.warn('Invalid address search request', { errors: validation.errors });
    res.status(400).json({ error: 'Invalid request', details: validation.errors });
    return;
  }

  const { postcode } = validation;
  const normalizedPostcode = postcode.replace(/\s/g, '').toUpperCase();

  try {
    // Step 1: Check cache first
    const cachedAddresses = await findCachedPostcodeLookup(postcode);

    if (cachedAddresses && cachedAddresses.length > 0) {
      logger.info('Returning cached postcode lookup (no Ideal Postcodes call)', { 
        postcode: normalizedPostcode,
        count: cachedAddresses.length 
      });

      const response: AddressSearchResponse = {
        postcode: normalizedPostcode,
        addresses: cachedAddresses.map(toAddressOption),
        count: cachedAddresses.length,
        cached: true,
      };

      res.status(200).json(response);
      return;
    }

    // Step 2: Not in cache, call Ideal Postcodes
    logger.info('Cache miss, calling Ideal Postcodes API', { postcode: normalizedPostcode });
    
    const result = await lookupPostcode(postcode, origin);

    if (!result.success) {
      logger.error('Ideal Postcodes lookup failed', { error: result.error });
      res.status(404).json({ error: `Address lookup failed: ${result.error}` });
      return;
    }

    if (result.addresses.length === 0) {
      logger.warn('No addresses found for postcode', { postcode: normalizedPostcode });
      res.status(404).json({ error: 'No addresses found for this postcode' });
      return;
    }

    // Step 3: Cache the result
    await cachePostcodeLookup(postcode, result.addresses);

    logger.info('Postcode lookup successful', { 
      postcode: normalizedPostcode,
      count: result.addresses.length 
    });

    const response: AddressSearchResponse = {
      postcode: normalizedPostcode,
      addresses: result.addresses.map(toAddressOption),
      count: result.addresses.length,
      cached: false,
    };

    res.status(200).json(response);
  } catch (err) {
    const errorResponse = handleError(err, { endpoint: '/api/address/search', origin });
    const statusCode = getStatusCode(err);
    res.status(statusCode).json(errorResponse);
  }
}

