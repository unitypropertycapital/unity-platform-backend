import { getFloorArea } from '../services/epc';
import { findCachedAddressById } from '../services/addressCache';
import { logger } from '../utils/logger';
import type { SubjectProperty, ResolvePropertyResult, PropertyType } from '../types/property';
import type { IdealPostcodesAddress } from '../types/services';
import type { PreResolvedAddress } from '../types/request';
import type { CachedAddress } from '../types/address';

export interface AddressInput {
  addressLine1: string;
  addressLine2?: string;
  postcode: string;
  propertyType: PropertyType;

  /**
   * Recommended: UUID from /api/address/resolve
   * If provided, uses cached address from Supabase
   */
  addressId?: string;

  /**
   * @deprecated Use addressId instead
   * Optional: Pre-resolved address from frontend
   * If provided, skips address lookup
   */
  resolvedAddress?: PreResolvedAddress;
}

interface EPCResult {
  floorAreaSqm: number | null;
  floorAreaSqFt: number | null;
  habitableRooms: number | null;
  epcRating: string | null;
  epcScore: number | null;
  epcAvailable: boolean;
  epcMissingReason: string | null;
}

/**
 * Fetch EPC data for floor area enrichment (MAT-1.3)
 */
async function fetchEPCData(
  uprn: string | null,
  postcode: string,
  addressLine1: string
): Promise<EPCResult> {
  const epcResult = await getFloorArea(uprn, postcode, addressLine1);

  if (epcResult.success) {
    logger.info('EPC data retrieved', {
      floorAreaSqm: epcResult.data.floorAreaSqm,
      floorAreaSqFt: epcResult.data.floorAreaSqFt,
      habitableRooms: epcResult.data.habitableRooms,
      epcRating: epcResult.data.currentRating,
      epcScore: epcResult.data.score,
    });
    return {
      floorAreaSqm: epcResult.data.floorAreaSqm,
      floorAreaSqFt: epcResult.data.floorAreaSqFt,
      habitableRooms: epcResult.data.habitableRooms,
      epcRating: epcResult.data.currentRating,
      epcScore: epcResult.data.score,
      epcAvailable: true,
      epcMissingReason: null,
    };
  }

  logger.warn('EPC data not available', { error: epcResult.error });
  return {
    floorAreaSqm: null,
    floorAreaSqFt: null,
    habitableRooms: null,
    epcRating: null,
    epcScore: null,
    epcAvailable: false,
    epcMissingReason: epcResult.error,
  };
}

/**
 * Convert cached address to internal format
 */
function cachedToInternalAddress(cached: CachedAddress): IdealPostcodesAddress {
  return {
    uprn: cached.uprn || '',
    latitude: cached.latitude || 0,
    longitude: cached.longitude || 0,
    line_1: cached.address_line_1 || '',
    line_2: cached.address_line_2 || '',
    line_3: '',
    post_town: cached.town || '',
    postcode: cached.postcode,
    building_name: '',
    building_number: cached.house_number,
    thoroughfare: '',
    country: cached.country || 'UK',
  };
}

/**
 * Build normalized address string from parts
 */
function buildNormalizedAddress(
  line1: string,
  line2: string | null,
  line3: string | null,
  town: string,
  postcode: string
): string {
  return [line1, line2, line3, town, postcode].filter(Boolean).join(', ');
}

/**
 * Resolve subject property from cached address ID
 * This is the recommended method - uses Supabase cache
 */
export async function resolveFromCachedAddress(
  addressId: string,
  input: AddressInput
): Promise<ResolvePropertyResult> {
  logger.info('Resolving from cached address', { addressId });

  const cached = await findCachedAddressById(addressId);

  if (!cached) {
    logger.error('Cached address not found', { addressId });
    return {
      success: false,
      error: 'Address not found. Please call /api/address/resolve first.',
      missingFields: ['addressId'],
    };
  }

  const matchedAddress = cachedToInternalAddress(cached);
  const normalizedAddress = buildNormalizedAddress(
    matchedAddress.line_1,
    matchedAddress.line_2 || null,
    matchedAddress.line_3 || null,
    matchedAddress.post_town,
    matchedAddress.postcode
  );

  logger.info('Address loaded from cache', {
    addressId,
    uprn: cached.uprn,
    latitude: cached.latitude,
    longitude: cached.longitude,
  });

  // Get EPC data
  const epcData = await fetchEPCData(cached.uprn, cached.postcode, input.addressLine1);

  // Build subject property
  const property: SubjectProperty = {
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2 || '',
    postcode: cached.postcode.toUpperCase(),
    propertyType: input.propertyType,
    line_1: matchedAddress.line_1,
    line_2: matchedAddress.line_2 || null,
    line_3: matchedAddress.line_3 || null,
    post_town: matchedAddress.post_town,
    normalizedAddress,
    uprn: matchedAddress.uprn,
    latitude: matchedAddress.latitude,
    longitude: matchedAddress.longitude,
    floorAreaSqm: epcData.floorAreaSqm,
    floorAreaSqFt: epcData.floorAreaSqFt,
    habitableRooms: epcData.habitableRooms,
    epcRating: epcData.epcRating,
    epcScore: epcData.epcScore,
    epcAvailable: epcData.epcAvailable,
    epcMissingReason: epcData.epcMissingReason,
  };

  logger.info('Subject property resolved from cache', {
    uprn: property.uprn,
    hasFloorArea: property.floorAreaSqm !== null,
  });

  return { success: true, property };
}

/**
 * Resolve subject property from pre-resolved address (deprecated)
 */
function resolveFromPreResolved(
  preResolved: PreResolvedAddress,
  input: AddressInput
): { matchedAddress: IdealPostcodesAddress; normalizedAddress: string } {
  const matchedAddress: IdealPostcodesAddress = {
    uprn: preResolved.uprn,
    latitude: preResolved.latitude,
    longitude: preResolved.longitude,
    line_1: preResolved.line_1,
    line_2: preResolved.line_2 || '',
    line_3: preResolved.line_3 || '',
    post_town: preResolved.post_town,
    postcode: input.postcode.toUpperCase(),
    building_name: '',
    building_number: '',
    thoroughfare: '',
    country: 'England',
  };

  const normalizedAddress = buildNormalizedAddress(
    matchedAddress.line_1,
    matchedAddress.line_2 || null,
    matchedAddress.line_3 || null,
    matchedAddress.post_town,
    matchedAddress.postcode
  );

  return { matchedAddress, normalizedAddress };
}

/**
 * Resolve a subject property from user input
 *
 * Priority:
 * 1. addressId (recommended) - fetches from Supabase cache
 * 2. resolvedAddress (deprecated) - uses inline pre-resolved data
 * 3. Neither - returns error directing user to /api/address/resolve
 *
 * NOTE: This function does NOT call Ideal Postcodes directly.
 * All Ideal Postcodes calls must go through /api/address/resolve.
 */
export async function resolveSubjectProperty(
  input: AddressInput,
  _origin?: string // No longer used, kept for backwards compatibility
): Promise<ResolvePropertyResult> {
  logger.info('Resolving subject property', {
    addressLine1: input.addressLine1,
    postcode: input.postcode,
    hasAddressId: !!input.addressId,
    hasPreResolved: !!input.resolvedAddress,
  });

  // Priority 1: Use addressId (recommended)
  if (input.addressId) {
    return resolveFromCachedAddress(input.addressId, input);
  }

  // Priority 2: Use pre-resolved address (deprecated but supported)
  if (input.resolvedAddress) {
    logger.warn('Using deprecated resolvedAddress. Please use addressId instead.');

    const { matchedAddress, normalizedAddress } = resolveFromPreResolved(
      input.resolvedAddress,
      input
    );

    logger.info('Address resolved from pre-resolved data', {
      uprn: matchedAddress.uprn,
      latitude: matchedAddress.latitude,
      longitude: matchedAddress.longitude,
    });

    // Get EPC data
    const epcData = await fetchEPCData(
      matchedAddress.uprn,
      input.postcode,
      input.addressLine1
    );

    // Build subject property
    const property: SubjectProperty = {
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2 || '',
      postcode: input.postcode.toUpperCase(),
      propertyType: input.propertyType,
      line_1: matchedAddress.line_1,
      line_2: matchedAddress.line_2 || null,
      line_3: matchedAddress.line_3 || null,
      post_town: matchedAddress.post_town,
      normalizedAddress,
      uprn: matchedAddress.uprn,
      latitude: matchedAddress.latitude,
      longitude: matchedAddress.longitude,
      floorAreaSqm: epcData.floorAreaSqm,
      floorAreaSqFt: epcData.floorAreaSqFt,
      habitableRooms: epcData.habitableRooms,
      epcRating: epcData.epcRating,
      epcScore: epcData.epcScore,
      epcAvailable: epcData.epcAvailable,
      epcMissingReason: epcData.epcMissingReason,
    };

    logger.info('Subject property resolved successfully', {
      uprn: property.uprn,
      hasFloorArea: property.floorAreaSqm !== null,
    });

    return { success: true, property };
  }

  // Neither addressId nor resolvedAddress provided
  // Return error directing user to /api/address/resolve
  logger.warn('No address resolution method provided', {
    addressLine1: input.addressLine1,
    postcode: input.postcode,
  });

  return {
    success: false,
    error: 'Address must be resolved first. Call POST /api/address/resolve with postcode and houseNumber, then pass the returned id as addressId.',
    missingFields: ['addressId'],
  };
}
