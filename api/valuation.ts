import type { VercelRequest, VercelResponse } from '@vercel/node';
import { logger } from '../src/utils/logger';
import { validateValuationRequest, ValuationRequest } from '../src/types/request';
import { resolveSubjectProperty } from '../src/engine/addressResolver';
import { getStreetViewImage } from '../src/services/streetView';
import { getGovEpcData, getDefaultGovEpcData } from '../src/services/govEpc';
import { fetchComparables, formatComparablesResponse } from '../src/engine/comparables';
import { calculateValuation } from '../src/engine/valuation';
import { classifyComparable } from '../src/engine/valuation/exLADetection';
import { getRequestOrigin } from '../src/utils/requestOrigin';
import { handleError, getStatusCode } from '../src/utils/errors';
import type { SubjectProperty } from '../src/types/property';
import type { StreetViewResult } from '../src/types/services';
import type { ComparablesResult } from '../src/types/comparable';
import type { ValuationResult } from '../src/engine/valuation';

/**
 * Build the success valuation response
 */
function buildSuccessResponse(
  property: SubjectProperty,
  streetView: StreetViewResult,
  comparablesResult: ComparablesResult,
  valuation: Extract<ValuationResult, { success: true }>
): Record<string, unknown> {
  const comparables = formatComparablesResponse(comparablesResult);
  
  // Add weights to kept comps for transparency
  const keptWithWeights = (comparables.kept as Array<Record<string, unknown>>).map((comp, index) => ({
    ...comp,
    weight: valuation.weightedComps[index]?.weight.total ?? null,
  }));
  
  return {
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

    streetViewUrl: streetView.url,
    streetViewAvailable: streetView.available,

    // Original market value (weighted median based)
    marketValue: {
      low: valuation.marketValue.low,
      central: valuation.marketValue.central,
      high: valuation.marketValue.high,
    },
    
    // Conservative market value (P25/median blend with penalties)
    conservativeMarketValue: valuation.conservativeMarketValue,

    // Offers based on conservative value
    offers: {
      fastTrack: valuation.offers.fastTrack,
      flexible: valuation.offers.flexible,
      selectedOfferType: valuation.offers.selectedOfferType,
    },

    confidence: {
      score: valuation.confidence.score,
      label: valuation.confidence.label,
    },

    deskReview: false,
    deskReviewReason: null,

    diagnostics: valuation.diagnostics,
    
    // Conservative diagnostics for calibration
    conservativeDiagnostics: valuation.conservativeDiagnostics,

    comparables: {
      ...comparables,
      kept: keptWithWeights,
    },

    timestamp: new Date().toISOString(),
  };
}

/**
 * Build the desk review response
 */
function buildDeskReviewResponse(
  property: SubjectProperty,
  streetView: StreetViewResult,
  comparablesResult: ComparablesResult,
  valuation: Extract<ValuationResult, { success: false }>
): Record<string, unknown> {
  const comparables = formatComparablesResponse(comparablesResult);
  
  return {
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

    streetViewUrl: streetView.url,
    streetViewAvailable: streetView.available,

    // Desk review - no valuation
    marketValue: null,
    conservativeMarketValue: null,
    offers: null,
    confidence: null,

    deskReview: true,
    deskReviewReason: valuation.deskReview.message,

    diagnostics: valuation.diagnostics,
    conservativeDiagnostics: null,
    comparables,

    timestamp: new Date().toISOString(),
  };
}

/**
 * Process the valuation request
 *
 * Includes Conservative Valuation Mode:
 * - Fetches Gov EPC data for construction age and floor count
 * - Applies block/ex-LA detection and penalties
 * - Returns both original and conservative market values
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
    addressId: data.addressId,
    resolvedAddress: data.resolvedAddress,
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
  
  // Early ex-LA classification for market segmentation
  // Uses building name from address (consistent with comparable classification)
  const subjectAddress = property.line_2 
    ? `${property.line_1}, ${property.line_2}` 
    : property.line_1;
  const subjectClassification = classifyComparable(subjectAddress, data.propertyType);
  
  logger.info('Subject property ex-LA classification', {
    isExLA: subjectClassification.isExLA,
    exLAScore: subjectClassification.exLAScore,
    address: subjectAddress,
  });
  
  // Fetch street view, comparables, and Gov EPC data in parallel
  const [streetViewResult, comparablesResult, govEpcResult] = await Promise.all([
    getStreetViewImage(property.latitude, property.longitude),
    fetchComparables({
      postcode: property.postcode,
      latitude: property.latitude,
      longitude: property.longitude,
      propertyType: data.propertyType,
      floorAreaSqm: property.floorAreaSqm,
      subjectIsExLA: subjectClassification.isExLA,
    }),
    // Include line_2 (building name) for better EPC matching
    getGovEpcData(
      property.uprn, 
      property.postcode, 
      property.line_2 ? `${property.line_1} ${property.line_2}` : property.line_1
    ),
  ]);
  
  // Extract Gov EPC data (or use defaults if not available)
  const govEpcData = govEpcResult.success ? govEpcResult.data : getDefaultGovEpcData();
  
  // Calculate postcode median for ex-LA detection
  const postcodeMedianPsqm = comparablesResult.stats.medianPricePerSqm;
  
  // Calculate valuation using the engine (with conservative mode)
  const valuationResult = calculateValuation({
    comparables: comparablesResult,
    subjectFloorAreaSqm: property.floorAreaSqm,
    saleTimeline: data.saleTimeline,
    // Conservative valuation inputs
    propertyType: data.propertyType,
    addressLine1: property.line_1,
    addressLine2: property.line_2,  // Building name often in line_2 for flats
    constructionAgeBand: govEpcData.constructionAgeBand,
    flatStoreyCount: govEpcData.flatStoreyCount,
    epcPropertyType: govEpcData.propertyType,
    postcodeMedianPsqm,
  });
  
  // Build response based on valuation result
  const response = valuationResult.success
    ? buildSuccessResponse(property, streetViewResult, comparablesResult, valuationResult)
    : buildDeskReviewResponse(property, streetViewResult, comparablesResult, valuationResult);

  res.status(200).json(response);

  // Log summary
  if (valuationResult.success) {
    logger.info('Valuation completed successfully', {
      uprn: property.uprn,
      marketValueCentral: valuationResult.marketValue.central,
      conservativeCentral: valuationResult.conservativeMarketValue?.central,
      confidenceScore: valuationResult.confidence.score,
      confidenceLabel: valuationResult.confidence.label,
      compsKept: comparablesResult.totalKept,
      radiusUsed: comparablesResult.radiusUsed,
    });
  } else {
    logger.info('Valuation requires desk review', {
      uprn: property.uprn,
      reason: valuationResult.deskReview.reason,
      message: valuationResult.deskReview.message,
      compsKept: comparablesResult.totalKept,
    });
  }
}

/**
 * POST /api/valuation
 *
 * Milestone 3: Full valuation with market value, offers, and confidence scoring
 * 
 * - Fetches comparables from PropertyData (Land Registry data)
 * - Applies radius expansion (0.25 → 0.5 → 0.75 → 1.0 miles)
 * - Filters by property type, recency, size, and outliers
 * - Calculates weighted £/sqm from comparables
 * - Returns market value band, offer ranges, and confidence score
 * - Triggers desk review when data quality is insufficient
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
