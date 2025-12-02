import type { VercelRequest, VercelResponse } from '@vercel/node';
import { logger } from '../src/utils/logger';
import { validateValuationRequest, ValuationRequest } from '../src/types/request';
import { resolveSubjectProperty } from '../src/engine/addressResolver';
import { getStreetViewImage } from '../src/services/streetView';
import { getRequestOrigin } from '../src/utils/requestOrigin';
import { handleError, getStatusCode, toErrorResponse } from '../src/utils/errors';
import type { SubjectProperty } from '../src/types/property';
import type { StreetViewResult } from '../src/types/services';

/**
 * Build the valuation response object
 * Includes MAT-1.2 address fields and MAT-1.3 EPC availability
 */
function buildValuationResponse(
  property: SubjectProperty,
  streetView: StreetViewResult
): Record<string, unknown> {
  return {
    _milestone: 1,
    _note: 'Full valuation will be available in Milestone 3',

    // MAT-1.2: Normalised address fields
    subjectProperty: {
      line_1: property.line_1,
      line_2: property.line_2,
      line_3: property.line_3,
      post_town: property.post_town,
      postcode: property.postcode,
      normalizedAddress: property.normalizedAddress,
      uprn: property.uprn,
      coordinates: {
        latitude: property.latitude,
        longitude: property.longitude,
      },
    },

    // MAT-1.3: EPC data with explicit availability flag
    epc: property.epcAvailable
      ? {
          available: true,
          floorAreaSqm: property.floorAreaSqm,
          floorAreaSqFt: property.floorAreaSqFt,
          habitableRooms: property.habitableRooms,
          rating: property.epcRating,
          score: property.epcScore,
        }
      : {
          available: false,
          missing_epc: true,
          reason: property.epcMissingReason,
        },

    // MAT-1.4: Street View URL
    streetViewUrl: streetView.url,
    streetViewAvailable: streetView.available,

    // Placeholder fields for Milestone 3
    marketValue: null,
    offers: null,
    confidence: null,
    comparables: null,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Process the valuation request
 *
 * NOTE: This function does NOT call Ideal Postcodes directly.
 * Address must be resolved via /api/address/resolve first,
 * then passed as addressId.
 */
async function processValuation(
  data: ValuationRequest,
  res: VercelResponse
): Promise<void> {
  const propertyResult = await resolveSubjectProperty({
    addressLine1: data.addressLine1,
    addressLine2: data.addressLine2,
    postcode: data.postcode,
    propertyType: data.propertyType,
    addressId: data.addressId, // Recommended: from /api/address/resolve
    resolvedAddress: data.resolvedAddress, // Deprecated: inline pre-resolved data
  });

  if (!propertyResult.success) {
    logger.warn('Property resolution failed', { error: propertyResult.error });
    res.status(400).json({
      error: 'Could not resolve property',
      details: propertyResult.error,
      missingFields: propertyResult.missingFields,
    });
    return;
  }

  const property = propertyResult.property;
  const streetViewResult = await getStreetViewImage(property.latitude, property.longitude);
  const response = buildValuationResponse(property, streetViewResult);

  res.status(200).json(response);

  logger.info('Valuation request processed (M1)', {
    uprn: property.uprn,
    epcAvailable: property.epcAvailable,
  });
}

/**
 * POST /api/valuation
 *
 * Milestone 1: Basic endpoint with address resolution only
 * Full valuation logic will be implemented in Milestone 3
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Set CORS headers
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
  logger.info('Valuation request received', { origin });

  const validation = validateValuationRequest(req.body);

  if (!validation.valid) {
    logger.warn('Invalid valuation request', { errors: validation.errors });
    res.status(400).json({ error: 'Invalid request', details: validation.errors });
    return;
  }

  try {
    await processValuation(validation.data, res);
  } catch (err) {
    // Centralized error handling - never silent
    const errorResponse = handleError(err, { endpoint: '/api/valuation', origin });
    const statusCode = getStatusCode(err);
    res.status(statusCode).json(errorResponse);
  }
}
