/**
 * Valuation Logger Service
 * Logs all valuation requests and results to Supabase
 */

import { getSupabaseClient } from './supabase';
import { logger } from '../utils/logger';
import type { SubjectProperty } from '../types/property';
import type { ValuationResult } from '../engine/valuation';
import type { ComparablesResult } from '../types/comparable';

/**
 * Data needed to log a valuation
 */
export interface ValuationLogData {
  // Request input
  inputAddress: string;
  inputAddress2?: string;
  postcode: string;
  propertyType: string;
  saleTimeline: string;
  reasonForSelling?: string;
  source?: string;
  
  // Resolved address
  addressId?: string;
  property?: SubjectProperty;
  
  // Results (if successful)
  valuation?: Extract<ValuationResult, { success: true }>;
  comparables?: ComparablesResult;
  
  // Street view
  streetViewUrl?: string;
  streetViewAvailable?: boolean;
  
  // Desk review
  deskReview?: boolean;
  deskReviewReason?: string;
  
  // Error info
  error?: string;
  
  // Request metadata
  requestOrigin?: string;
  requestIp?: string;
  hmacValid?: boolean;
  processingTimeMs?: number;
}

/**
 * Log a valuation to the database
 * Returns the valuation ID if successful
 */
export async function logValuation(data: ValuationLogData): Promise<string | null> {
  try {
    // Determine status
    let status = 'success';
    if (data.error) {
      status = 'error';
    } else if (data.deskReview) {
      status = 'desk_review';
    }

    // Build the valuation record
    const record: Record<string, unknown> = {
      // Request input
      input_address: data.inputAddress,
      input_address_2: data.inputAddress2 || null,
      postcode: data.postcode,
      property_type: data.propertyType,
      sale_timeline: data.saleTimeline,
      reason_for_selling: data.reasonForSelling || null,
      source: data.source || null,
      
      // Resolved address
      address_id: data.addressId || null,
      uprn: data.property?.uprn || null,
      latitude: data.property?.latitude || null,
      longitude: data.property?.longitude || null,
      normalized_address: data.property?.normalizedAddress || null,
      
      // EPC data
      epc_available: data.property?.epcAvailable || false,
      floor_area_sqm: data.property?.floorAreaSqm || null,
      floor_area_sqft: data.property?.floorAreaSqFt || null,
      habitable_rooms: data.property?.habitableRooms || null,
      epc_rating: data.property?.epcRating || null,
      epc_score: data.property?.epcScore || null,
      
      // Street view
      street_view_url: data.streetViewUrl || null,
      street_view_available: data.streetViewAvailable || false,
      
      // Desk review
      desk_review: data.deskReview || false,
      desk_review_reason: data.deskReviewReason || null,
      
      // Request metadata
      request_origin: data.requestOrigin || null,
      request_ip: data.requestIp || null,
      hmac_valid: data.hmacValid || false,
      processing_time_ms: data.processingTimeMs || null,
      
      // Status
      status,
      error_message: data.error || null,
    };

    // Add valuation results if available
    if (data.valuation) {
      record.market_value_low = data.valuation.marketValue.low;
      record.market_value_central = data.valuation.marketValue.central;
      record.market_value_high = data.valuation.marketValue.high;
      
      if (data.valuation.conservativeMarketValue) {
        record.conservative_value_low = data.valuation.conservativeMarketValue.low;
        record.conservative_value_mid = data.valuation.conservativeMarketValue.central;
        record.conservative_value_high = data.valuation.conservativeMarketValue.high;
      }
      
      // Offers are ranges with low/high - store the low (minimum) value
      record.fast_track_offer = data.valuation.offers.fastTrack?.low || null;
      record.flexible_offer = data.valuation.offers.flexible?.low || null;
      record.selected_offer_type = data.valuation.offers.selectedOfferType;
      
      record.confidence_score = data.valuation.confidence.score;
      record.confidence_label = data.valuation.confidence.label;
      
      record.diagnostics = data.valuation.diagnostics;
      record.conservative_diagnostics = data.valuation.conservativeDiagnostics;
      
      // Ex-LA detection from diagnostics
      if (data.valuation.conservativeDiagnostics) {
        record.is_ex_local_authority = data.valuation.conservativeDiagnostics.isExLocalAuthority || false;
        record.ex_la_score = data.valuation.conservativeDiagnostics.exLAScore || null;
      }
    }

    // Add comparables metadata
    if (data.comparables) {
      record.search_radius_miles = data.comparables.radiusUsed || null;
      record.comps_kept_count = data.comparables.kept?.length || 0;
      record.comps_rejected_count = data.comparables.rejected?.length || 0;
    }

    // Insert into database
    const supabase = getSupabaseClient();
    const { data: inserted, error } = await supabase
      .from('valuations')
      .insert(record)
      .select('id')
      .single();

    if (error) {
      logger.error('Failed to log valuation to database', { error: error.message });
      return null;
    }

    const valuationId = inserted?.id as string;
    logger.info('Valuation logged to database', { valuationId, status });

    // Log comparables if we have them and the valuation was inserted
    if (valuationId && data.comparables) {
      await logComparables(valuationId, data.comparables);
    }

    return valuationId;
  } catch (err) {
    logger.error('Exception while logging valuation', { error: (err as Error).message });
    return null;
  }
}

/**
 * Log comparables (kept and rejected) for a valuation
 */
async function logComparables(valuationId: string, comparables: ComparablesResult): Promise<void> {
  try {
    const records: Record<string, unknown>[] = [];

    // Add kept comparables
    if (comparables.kept && comparables.kept.length > 0) {
      for (const comp of comparables.kept) {
        records.push({
          valuation_id: valuationId,
          address: comp.address || 'Unknown',
          postcode: comp.postcode || null,
          uprn: null, // NormalizedComparable doesn't have uprn
          sale_price: comp.salePrice || 0,
          sale_date: comp.saleDate || null,
          months_ago: comp.ageMonths || null,
          property_type: comp.propertyType || null,
          floor_area_sqm: comp.floorAreaSqm || null,
          price_per_sqm: comp.pricePerSqm || null,
          latitude: comp.latitude || null,
          longitude: comp.longitude || null,
          distance_miles: comp.distanceMiles || null,
          weight: null, // Weight is added in response formatting, not on the comp itself
          status: 'kept',
          rejection_reason: null,
          rejection_category: null,
          epc_rating: null,
          habitable_rooms: null,
          is_ex_local_authority: comp.isExLA || false,
          ex_la_score: comp.exLAScore || null,
        });
      }
    }

    // Add rejected comparables (limit to first 50 to avoid bloat)
    if (comparables.rejected && comparables.rejected.length > 0) {
      const rejectedToLog = comparables.rejected.slice(0, 50);
      for (const rejected of rejectedToLog) {
        const comp = rejected.comp;
        records.push({
          valuation_id: valuationId,
          address: comp.address || 'Unknown',
          postcode: comp.postcode || null,
          uprn: null,
          sale_price: comp.salePrice || 0,
          sale_date: comp.saleDate || null,
          months_ago: comp.ageMonths || null,
          property_type: comp.propertyType || null,
          floor_area_sqm: comp.floorAreaSqm || null,
          price_per_sqm: comp.pricePerSqm || null,
          latitude: comp.latitude || null,
          longitude: comp.longitude || null,
          distance_miles: comp.distanceMiles || null,
          weight: null,
          status: 'rejected',
          rejection_reason: rejected.details || null,
          rejection_category: rejected.reason || null,
          epc_rating: null,
          habitable_rooms: null,
          is_ex_local_authority: comp.isExLA || false,
          ex_la_score: comp.exLAScore || null,
        });
      }
    }

    // Batch insert all comps
    if (records.length > 0) {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('comps').insert(records);
      
      if (error) {
        logger.error('Failed to log comparables to database', { 
          error: error.message,
          valuationId,
          count: records.length 
        });
      } else {
        logger.info('Comparables logged to database', { 
          valuationId, 
          kept: comparables.kept?.length || 0,
          rejected: Math.min(comparables.rejected?.length || 0, 50)
        });
      }
    }
  } catch (err) {
    logger.error('Exception while logging comparables', { 
      error: (err as Error).message,
      valuationId 
    });
  }
}

