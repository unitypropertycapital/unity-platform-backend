/**
 * Valuation Engine
 * Main orchestrator for calculating market value, offers, and confidence
 * 
 * Includes Conservative Valuation Mode:
 * - P25/median blend for base £/sqm
 * - Block, small unit, confidence, and CV penalties
 * - Offers based on conservative central value
 */

import { logger } from '../../utils/logger';
import type { NormalizedComparable, ComparablesResult } from '../../types/comparable';
import type { SaleTimeline } from '../../types/request';

import { calculateWeightedPsqm, type WeightedComp } from './weights';
import { calculateMarketValue, type MarketValueBand } from './marketValue';
import { calculateOffers, calculateConservativeOffers, type OffersResult, type OfferType } from './offers';
import {
  calculateConfidence,
  calculateAverageAge,
  type ConfidenceResult,
  type ConfidenceLabel,
} from './confidence';
import {
  checkDeskReview,
  wasAlreadyFlaggedForReview,
  type DeskReviewResult,
  type DeskReviewReason,
} from './deskReview';
import { detectFlatBlock, type BlockDetectionResult } from './blockDetection';
import { detectExLA, extractBuildingName, type ExLADetectionResult } from './exLADetection';
import {
  calculateConservativeValue,
  type ConservativeMarketValue,
  type ConservativeDiagnostics,
} from './conservativeValue';

// Re-export types
export type { MarketValueBand } from './marketValue';
export type { OffersResult, OfferType, OfferRange } from './offers';
export type { ConfidenceResult, ConfidenceLabel } from './confidence';
export type { DeskReviewResult, DeskReviewReason } from './deskReview';
export type { WeightedComp, CompWeight } from './weights';
export type { BlockDetectionResult } from './blockDetection';
export type { ExLADetectionResult } from './exLADetection';
export type { ConservativeMarketValue, ConservativeDiagnostics } from './conservativeValue';

/**
 * Input parameters for valuation calculation
 */
export interface ValuationInput {
  comparables: ComparablesResult;
  subjectFloorAreaSqm: number | null;
  saleTimeline: SaleTimeline;
  
  // For conservative valuation
  propertyType: string;
  addressLine1: string;
  addressLine2?: string | null;  // Building name often in line 2 for flats
  constructionAgeBand: string | null;
  flatStoreyCount: number | null;
  epcPropertyType: string | null;
  postcodeMedianPsqm: number | null;
}

/**
 * Diagnostics for transparency
 */
export interface ValuationDiagnostics {
  radiusUsed: number;
  compsKept: number;
  compsRejected: number;
  weightedMedianPsqm: number | null;
  weightedMeanPsqm: number | null;
  bandPercent: number | null;
  avgAgeMonths: number | null;
  coefficientOfVariation: number | null;
}

/**
 * Successful valuation result
 */
export interface ValuationSuccess {
  success: true;
  marketValue: MarketValueBand;
  conservativeMarketValue: ConservativeMarketValue | null;
  offers: OffersResult;
  confidence: ConfidenceResult;
  diagnostics: ValuationDiagnostics;
  conservativeDiagnostics: ConservativeDiagnostics | null;
  weightedComps: WeightedComp[];
}

/**
 * Desk review result (no valuation)
 */
export interface ValuationDeskReview {
  success: false;
  deskReview: DeskReviewResult;
  diagnostics: Partial<ValuationDiagnostics>;
}

/**
 * Combined valuation result type
 */
export type ValuationResult = ValuationSuccess | ValuationDeskReview;

/**
 * Calculate valuation from comparables
 * 
 * This is the main entry point for the valuation engine.
 * It orchestrates:
 * 1. Desk review checks (fail-fast if data quality issues)
 * 2. Weight calculation for each comparable
 * 3. Weighted median £/sqm calculation
 * 4. Market value band calculation
 * 5. Conservative valuation calculation (P25/median blend + penalties)
 * 6. Offer range calculation (based on conservative value)
 * 7. Confidence score calculation
 */
export function calculateValuation(input: ValuationInput): ValuationResult {
  const {
    comparables,
    subjectFloorAreaSqm,
    saleTimeline,
    propertyType,
    addressLine1,
    addressLine2,
    constructionAgeBand,
    flatStoreyCount,
    epcPropertyType,
    postcodeMedianPsqm,
  } = input;
  
  logger.info('Calculating valuation', {
    compsKept: comparables.totalKept,
    radiusUsed: comparables.radiusUsed,
    subjectFloorAreaSqm,
    saleTimeline,
    propertyType,
  });
  
  // Check if already flagged for desk review by comparables engine
  const priorReview = wasAlreadyFlaggedForReview(
    comparables.deskReview,
    comparables.deskReviewReason
  );
  
  if (priorReview.required) {
    logger.info('Desk review required (prior flag)', {
      reason: priorReview.reason,
    });
    
    return {
      success: false,
      deskReview: priorReview,
      diagnostics: {
        radiusUsed: comparables.radiusUsed,
        compsKept: comparables.totalKept,
        compsRejected: comparables.totalRejected,
      },
    };
  }
  
  // Calculate average age of kept comps
  const avgAgeMonths = calculateAverageAge(
    comparables.kept.map((c) => c.ageMonths)
  );
  
  // Run desk review checks
  const deskReview = checkDeskReview({
    subjectFloorAreaSqm,
    compsKept: comparables.totalKept,
    stdDevPsqm: comparables.stats.stdDevPricePerSqm,
    meanPsqm: comparables.stats.meanPricePerSqm,
    avgAgeMonths,
  });
  
  if (deskReview.required) {
    logger.info('Desk review required', {
      reason: deskReview.reason,
      message: deskReview.message,
    });
    
    // Calculate CV for diagnostics even when desk review triggered
    const cv = (comparables.stats.stdDevPricePerSqm && comparables.stats.meanPricePerSqm)
      ? comparables.stats.stdDevPricePerSqm / comparables.stats.meanPricePerSqm
      : null;
    
    return {
      success: false,
      deskReview,
      diagnostics: {
        radiusUsed: comparables.radiusUsed,
        compsKept: comparables.totalKept,
        compsRejected: comparables.totalRejected,
        avgAgeMonths,
        coefficientOfVariation: cv ? Math.round(cv * 100) / 100 : null,
      },
    };
  }
  
  // All checks passed - calculate valuation
  try {
    // Calculate weighted £/sqm (for original market value)
    const { weightedMedianPsqm, weightedMeanPsqm, weightedComps } = calculateWeightedPsqm(
      comparables.kept,
      subjectFloorAreaSqm
    );
    
    // Calculate confidence first (needed for band percent decision and penalties)
    const confidence = calculateConfidence({
      compsCount: comparables.totalKept,
      radiusUsed: comparables.radiusUsed,
      stdDevPsqm: comparables.stats.stdDevPricePerSqm,
      meanPsqm: comparables.stats.meanPricePerSqm,
      avgAgeMonths,
    });
    
    // Calculate original market value band
    const marketValue = calculateMarketValue({
      weightedMedianPsqm,
      subjectFloorAreaSqm: subjectFloorAreaSqm!, // Safe - desk review checked this
      radiusUsed: comparables.radiusUsed,
      confidenceScore: confidence.score,
    });
    
    // Calculate CV for diagnostics and conservative penalties
    const cv = (comparables.stats.stdDevPricePerSqm && comparables.stats.meanPricePerSqm)
      ? comparables.stats.stdDevPricePerSqm / comparables.stats.meanPricePerSqm
      : null;
    
    // === Conservative Valuation ===
    
    // Detect if property is a flat/block
    const blockDetection = detectFlatBlock(propertyType, addressLine1, epcPropertyType);
    
    // Detect ex-local authority (full detection with all 4 signals)
    // Building name is often in line_2 for flats (e.g., "Flat 4" + "Sudbury House")
    // Note: Market segmentation already happened during comparable fetching (early classification)
    // This detection is for penalty calculation and diagnostics
    const fullAddress = addressLine2 
      ? `${addressLine1}, ${addressLine2}`
      : addressLine1;
    const buildingName = addressLine2 || extractBuildingName(fullAddress);
    const compPricesPerSqm = comparables.kept
      .map(c => c.pricePerSqm)
      .filter((p): p is number => p !== null);
    
    const exLADetection = detectExLA({
      buildingName,
      constructionAgeBand,
      flatStoreyCount,
      compPricesPerSqm,
      postcodeMedianPsqm,
    });
    
    // Use all kept comps for conservative valuation
    // Market segmentation (ex-LA vs private) already applied during comparable fetching
    // Stats (P25/median) are calculated from segment-matched comps
    const compsForConservative = comparables.kept;
    
    logger.info('Ex-LA detection (full)', {
      isExLocalAuthority: exLADetection.isExLocalAuthority,
      exLAScore: exLADetection.exLAScore,
      signals: exLADetection.signals,
      compsUsed: compsForConservative.length,
    });
    
    // Calculate conservative value using segment-matched comps
    const conservativeResult = calculateConservativeValue({
      comps: compsForConservative,
      subjectFloorAreaSqm,
      isFlatBlock: blockDetection.isFlatBlock,
      exLAScore: exLADetection.exLAScore,
      isExLocalAuthority: exLADetection.isExLocalAuthority,
      constructionAgeBand,
      flatStoreyCount,
      confidenceScore: confidence.score,
      coefficientOfVariation: cv,
    });
    
    // Calculate offers based on conservative value (or original if conservative not available)
    const offerBase = conservativeResult.conservativeMarketValue?.central ?? marketValue.central;
    const offers = conservativeResult.conservativeMarketValue
      ? calculateConservativeOffers(offerBase, saleTimeline)
      : calculateOffers(offerBase, saleTimeline);
    
    logger.info('Valuation calculated successfully', {
      marketValueCentral: marketValue.central,
      conservativeCentral: conservativeResult.conservativeMarketValue?.central,
      confidenceScore: confidence.score,
      confidenceLabel: confidence.label,
      selectedOffer: offers.selectedOfferType,
      isFlatBlock: blockDetection.isFlatBlock,
      isExLocalAuthority: exLADetection.isExLocalAuthority,
    });
    
    return {
      success: true,
      marketValue,
      conservativeMarketValue: conservativeResult.conservativeMarketValue,
      offers,
      confidence,
      diagnostics: {
        radiusUsed: comparables.radiusUsed,
        compsKept: comparables.totalKept,
        compsRejected: comparables.totalRejected,
        weightedMedianPsqm,
        weightedMeanPsqm,
        bandPercent: marketValue.bandPercent * 100, // Convert to percentage
        avgAgeMonths: Math.round(avgAgeMonths * 10) / 10,
        coefficientOfVariation: cv ? Math.round(cv * 100) / 100 : null,
      },
      conservativeDiagnostics: conservativeResult.diagnostics,
      weightedComps,
    };
  } catch (error) {
    // Unexpected error during calculation
    logger.error('Valuation calculation error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    
    return {
      success: false,
      deskReview: {
        required: true,
        reason: 'fetch_error',
        message: `Calculation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      diagnostics: {
        radiusUsed: comparables.radiusUsed,
        compsKept: comparables.totalKept,
        compsRejected: comparables.totalRejected,
      },
    };
  }
}
