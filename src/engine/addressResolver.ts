import { lookupPostcode, findAddressMatch } from '../services/idealPostcodes';
import { getFloorArea } from '../services/epc';
import { logger } from '../utils/logger';
import type { SubjectProperty, ResolvePropertyResult, PropertyType } from '../types/property';
import type { IdealPostcodesAddress } from '../types/services';

export interface AddressInput {
  addressLine1: string;
  addressLine2?: string;
  postcode: string;
  propertyType: PropertyType;
}

type AddressLookupResult =
  | {
      success: true;
      address: IdealPostcodesAddress;
      normalizedAddress: string;
    }
  | {
      success: false;
      error: string;
      missingFields: string[];
    };

/**
 * Look up postcode and find matching address
 */
async function lookupAndMatchAddress(
  postcode: string,
  addressLine1: string,
  origin?: string
): Promise<AddressLookupResult> {
  const postcodeResult = await lookupPostcode(postcode, origin);

  if (!postcodeResult.success) {
    logger.error('Postcode lookup failed', { error: postcodeResult.error });
    return {
      success: false,
      error: `Could not find postcode: ${postcodeResult.error}`,
      missingFields: ['postcode'],
    };
  }

  if (postcodeResult.addresses.length === 0) {
    logger.error('No addresses found for postcode', { postcode });
    return {
      success: false,
      error: 'No addresses found for this postcode',
      missingFields: ['address'],
    };
  }

  const matchedAddress = findAddressMatch(postcodeResult.addresses, addressLine1);

  if (!matchedAddress) {
    logger.warn('No exact address match found', {
      addressLine1,
      availableAddresses: postcodeResult.addresses.length,
    });
    return {
      success: false,
      error: 'Could not match address to any property at this postcode',
      missingFields: ['addressLine1'],
    };
  }

  const addressParts = [
    matchedAddress.line_1,
    matchedAddress.line_2,
    matchedAddress.line_3,
    matchedAddress.post_town,
    matchedAddress.postcode,
  ].filter(Boolean);

  return {
    success: true,
    address: matchedAddress,
    normalizedAddress: addressParts.join(', '),
  };
}

interface EPCResult {
  floorAreaSqm: number | null;
  epcRating: string | null;
  epcAvailable: boolean;
  epcMissingReason: string | null;
}

/**
 * Fetch EPC data for floor area enrichment (MAT-1.3)
 */
async function fetchEPCData(
  uprn: string,
  postcode: string,
  addressLine1: string
): Promise<EPCResult> {
  const epcResult = await getFloorArea(uprn, postcode, addressLine1);

  if (epcResult.success) {
    logger.info('EPC data retrieved', {
      floorAreaSqm: epcResult.data.floorAreaSqm,
      epcRating: epcResult.data.currentRating,
    });
    return {
      floorAreaSqm: epcResult.data.floorAreaSqm,
      epcRating: epcResult.data.currentRating,
      epcAvailable: true,
      epcMissingReason: null,
    };
  }

  logger.warn('EPC data not available', { error: epcResult.error });
  return {
    floorAreaSqm: null,
    epcRating: null,
    epcAvailable: false,
    epcMissingReason: epcResult.error,
  };
}

/**
 * Resolve a subject property from user input
 *
 * @param input - Address input from user
 * @param origin - Optional origin URL for API whitelist verification
 */
export async function resolveSubjectProperty(
  input: AddressInput,
  origin?: string
): Promise<ResolvePropertyResult> {
  logger.info('Resolving subject property', {
    addressLine1: input.addressLine1,
    postcode: input.postcode,
  });

  // Step 1-2: Look up postcode and find matching address
  const lookupResult = await lookupAndMatchAddress(input.postcode, input.addressLine1, origin);

  if (!lookupResult.success) {
    return lookupResult;
  }

  const { address: matchedAddress, normalizedAddress } = lookupResult;

  logger.info('Address resolved via Ideal Postcodes', {
    uprn: matchedAddress.uprn,
    latitude: matchedAddress.latitude,
    longitude: matchedAddress.longitude,
    normalizedAddress,
  });

  // Step 3: Get floor area from EPC (optional)
  const epcData = await fetchEPCData(
    matchedAddress.uprn,
    input.postcode,
    input.addressLine1
  );

  // Step 4: Build result with normalised address fields (MAT-1.2) and EPC status (MAT-1.3)
  const property: SubjectProperty = {
    // Original input fields
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2 || '',
    postcode: input.postcode.toUpperCase(),
    propertyType: input.propertyType,

    // Normalised address fields from Ideal Postcodes (MAT-1.2)
    line_1: matchedAddress.line_1,
    line_2: matchedAddress.line_2 || null,
    line_3: matchedAddress.line_3 || null,
    post_town: matchedAddress.post_town,
    normalizedAddress,

    // Location identifiers
    uprn: matchedAddress.uprn,
    latitude: matchedAddress.latitude,
    longitude: matchedAddress.longitude,

    // EPC data (MAT-1.3)
    floorAreaSqm: epcData.floorAreaSqm,
    epcRating: epcData.epcRating,
    epcAvailable: epcData.epcAvailable,
    epcMissingReason: epcData.epcMissingReason,
  };

  logger.info('Subject property resolved successfully', {
    uprn: property.uprn,
    hasFloorArea: property.floorAreaSqm !== null,
  });

  return { success: true, property };
}
