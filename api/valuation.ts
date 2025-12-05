import type { VercelRequest, VercelResponse } from '@vercel/node';
import { logger } from '../src/utils/logger';
import { validateValuationRequest, ValuationRequest } from '../src/types/request';
import { resolveSubjectProperty } from '../src/engine/addressResolver';
import { getStreetViewImage } from '../src/services/streetView';
import { fetchComparables, formatComparablesResponse } from '../src/engine/comparables';
import { getRequestOrigin } from '../src/utils/requestOrigin';
import { handleError, getStatusCode } from '../src/utils/errors';
import type { SubjectProperty } from '../src/types/property';
import type { StreetViewResult } from '../src/types/services';
import type { ComparablesResult } from '../src/types/comparable';

/**
 * Build the valuation response object
 * Includes MAT-1.2 address fields, MAT-1.3 EPC, and MAT-2 comparables
 */
function buildValuationResponse(
  property: SubjectProperty,
  streetView: StreetViewResult,
  comparablesResult: ComparablesResult
): Record<string, unknown> {
  const comparables = formatComparablesResponse(comparablesResult);
  
  return {
    _milestone: 2,
    _note: 'Full valuation calculations will be available in Milestone 3',

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

    // MAT-2: Comparables with filtering and diagnostics
    comparables,
    
    // Desk review flag (from comparables)
    deskReview: comparablesResult.deskReview,
    deskReviewReason: comparablesResult.deskReviewReason,

    // Placeholder fields for Milestone 3
    marketValue: null,
    offers: null,
    confidence: null,
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
  
  // Fetch street view and comparables in parallel
  const [streetViewResult, comparablesResult] = await Promise.all([
    getStreetViewImage(property.latitude, property.longitude),
    fetchComparables({
      postcode: property.postcode,
      latitude: property.latitude,
      longitude: property.longitude,
      propertyType: data.propertyType,
      floorAreaSqm: property.floorAreaSqm,
    }),
  ]);
  
  const response = buildValuationResponse(property, streetViewResult, comparablesResult);

  res.status(200).json(response);

  logger.info('Valuation request processed (M2)', {
    uprn: property.uprn,
    epcAvailable: property.epcAvailable,
    comparablesKept: comparablesResult.totalKept,
    comparablesRejected: comparablesResult.totalRejected,
    radiusUsed: comparablesResult.radiusUsed,
    deskReview: comparablesResult.deskReview,
  });
}

/**
 * POST /api/valuation
 *
 * Milestone 2: Address resolution + Comparable data fetching & filtering
 * - Fetches comparables from PropertyData (Land Registry data)
 * - Applies radius expansion (0.25 → 0.5 → 0.75 → 1.0 miles)
 * - Filters by property type, recency, size, and outliers
 * - Returns kept/rejected comps with reasons
 * 
 * Full valuation calculations will be implemented in Milestone 3
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
