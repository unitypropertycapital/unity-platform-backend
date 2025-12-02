/**
 * Address Cache Types
 * Types for the Supabase addresses cache table and API requests/responses
 */

/**
 * Cached address row from Supabase
 */
export interface CachedAddress {
  id: string;
  postcode: string;
  house_number: string;
  address_line_1: string | null;
  address_line_2: string | null;
  town: string | null;
  county: string | null;
  country: string;
  uprn: string | null;
  udprn: string | null;
  latitude: number | null;
  longitude: number | null;
  provider_raw: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/**
 * Request body for POST /api/address/resolve
 */
export interface AddressResolveRequest {
  postcode: string;
  houseNumber: string;
  town?: string;
}

/**
 * Success response from /api/address/resolve
 */
export interface AddressResolveResponse {
  id: string;
  postcode: string;
  house_number: string;
  address_line_1: string | null;
  address_line_2: string | null;
  town: string | null;
  county: string | null;
  country: string;
  uprn: string | null;
  udprn: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Error response from /api/address/resolve
 */
export interface AddressResolveError {
  error: string;
  details?: string;
}

/**
 * Data to insert into addresses table
 */
export interface AddressInsertData {
  postcode: string;
  house_number: string;
  address_line_1: string | null;
  address_line_2: string | null;
  town: string | null;
  county: string | null;
  country: string;
  uprn: string | null;
  udprn: string | null;
  latitude: number | null;
  longitude: number | null;
  provider_raw: Record<string, unknown> | null;
}

/**
 * Alias for AddressInsertData (for backwards compatibility)
 */
export type AddressCacheInsert = AddressInsertData;

/**
 * Validation result for address resolve request
 */
export type AddressValidationResult =
  | { valid: true; postcode: string; houseNumber: string; town?: string }
  | { valid: false; errors: string[] };

/**
 * Validate address resolve request body
 */
export function validateAddressResolveRequest(
  body: unknown
): AddressValidationResult {
  const errors: string[] = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be an object'] };
  }

  const data = body as Record<string, unknown>;

  if (typeof data.postcode !== 'string' || !data.postcode.trim()) {
    errors.push('postcode is required');
  }

  if (typeof data.houseNumber !== 'string' || !data.houseNumber.trim()) {
    errors.push('houseNumber is required');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    postcode: (data.postcode as string).trim().toUpperCase(),
    houseNumber: (data.houseNumber as string).trim().toLowerCase(),
    town: typeof data.town === 'string' ? data.town.trim() : undefined,
  };
}
