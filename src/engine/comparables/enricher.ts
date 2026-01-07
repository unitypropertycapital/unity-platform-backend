/**
 * Comparable Enricher
 * Enriches comparables with floor area data from PropertyData /floor-areas endpoint
 */

import { httpRequest } from '../../utils/httpClient';
import { config } from '../../utils/config';
import { logger } from '../../utils/logger';
import type { NormalizedComparable } from '../../types/comparable';

const BASE_URL = config.urls.propertyData;
const PROPERTYDATA_TIMEOUT = 5000;

// Square feet to square meters conversion factor
const SQ_FT_TO_SQ_M = 0.092903;

// Square meters to square feet
const SQM_TO_SQFT = 10.7639;

/**
 * PropertyData /floor-areas response structure
 * Based on actual API response format
 */
interface FloorAreaRecord {
  inspection_date: string;
  address: string;
  square_feet: number;
  habitable_rooms: number;
}

interface PropertyDataFloorAreasResponse {
  status: string;
  postcode?: string;
  known_floor_areas?: FloorAreaRecord[];
}

/**
 * Extract postcode from a comparable's address
 * PropertyData sold prices include postcode in address like "1, Street Name, AB1 2CD"
 */
function extractPostcodeFromAddress(address: string): string | null {
  // UK postcode regex - matches formats like "AB1 2CD", "AB12 3CD", etc.
  const postcodeRegex = /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i;
  const match = address.match(postcodeRegex);
  return match ? match[1].toUpperCase().replace(/\s+/g, ' ') : null;
}

/**
 * Normalize address for comparison
 */
function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract building identifier (number or name) from address
 */
function extractBuildingId(address: string): string | null {
  const normalized = address.toLowerCase();
  
  // Try various patterns
  const patterns = [
    /^flat\s+(\d+[a-z]?)/i,           // "Flat 1" or "Flat 1a"
    /^(\d+[a-z]?),?\s/i,              // "36" or "36a" at start
    /,\s*(\d+[a-z]?),?\s/i,           // ", 36 " in middle
    /^([a-z\s]+cottage)/i,            // "Oak Cottage"
    /^([a-z\s]+house)/i,              // "Manor House"
    /^([a-z\s]+lodge)/i,              // "Pine Lodge"
  ];
  
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return match[1].trim();
  }
  
  return null;
}

/**
 * Calculate match score between two addresses
 * Higher score = better match
 */
function calculateAddressMatchScore(compAddress: string, floorAddress: string): number {
  const compNorm = normalizeAddress(compAddress);
  const floorNorm = normalizeAddress(floorAddress);
  
  // Exact match (best)
  if (compNorm === floorNorm) return 100;
  
  // One contains the other
  if (compNorm.includes(floorNorm) || floorNorm.includes(compNorm)) return 80;
  
  // Building ID match
  const compId = extractBuildingId(compAddress);
  const floorId = extractBuildingId(floorAddress);
  if (compId && floorId && compId === floorId) {
    // Check if street name also matches
    const compStreet = compNorm.replace(/\d+[a-z]?/g, '').trim();
    const floorStreet = floorNorm.replace(/\d+[a-z]?/g, '').trim();
    if (compStreet.includes(floorStreet) || floorStreet.includes(compStreet)) {
      return 70;
    }
    return 50;
  }
  
  return 0;
}

/**
 * Find best floor area match for a comparable
 */
function findBestFloorAreaMatch(
  comp: NormalizedComparable,
  floorAreas: FloorAreaRecord[]
): FloorAreaRecord | null {
  let bestMatch: FloorAreaRecord | null = null;
  let bestScore = 0;
  
  for (const record of floorAreas) {
    const score = calculateAddressMatchScore(comp.address, record.address);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = record;
    }
  }
  
  // Only return if score is good enough (at least building ID match)
  return bestScore >= 50 ? bestMatch : null;
}

/**
 * Fetch floor areas for a postcode
 */
async function fetchFloorAreasForPostcode(
  postcode: string
): Promise<FloorAreaRecord[]> {
  const cleanPostcode = postcode.replace(/\s/g, '+').toUpperCase();
  const url = `${BASE_URL}/floor-areas?key=${config.propertyDataApiKey}&postcode=${cleanPostcode}`;
  
  const result = await httpRequest<PropertyDataFloorAreasResponse>(url, {
    timeout: PROPERTYDATA_TIMEOUT,
  });
  
  if (!result.success) {
    logger.warn(`Floor areas fetch failed for ${postcode}: ${result.error.message}`);
    return [];
  }
  
  const response = result.response.data;
  if (response.status !== 'success' || !response.known_floor_areas?.length) {
    logger.debug(`No floor areas found for ${postcode}`);
    return [];
  }
  
  logger.info(`📐 Floor areas: ${response.known_floor_areas.length} records for ${postcode}`);
  return response.known_floor_areas;
}

/**
 * Extract unique postcodes from comparables
 * Returns full postcodes for API calls
 */
function extractUniquePostcodes(comps: NormalizedComparable[]): Set<string> {
  const postcodes = new Set<string>();
  
  for (const comp of comps) {
    // Try to extract postcode from address
    const postcode = extractPostcodeFromAddress(comp.address) || comp.postcode;
    if (postcode) {
      // Normalize to format "AB1 2CD"
      const normalized = postcode.toUpperCase().replace(/\s+/g, '');
      if (normalized.length >= 5) {
        const outward = normalized.slice(0, -3);
        const inward = normalized.slice(-3);
        postcodes.add(`${outward} ${inward}`);
      }
    }
  }
  
  return postcodes;
}

/**
 * Delay helper for rate limiting
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch floor areas for a postcode with retry on 429
 */
async function fetchFloorAreasWithRetry(
  postcode: string,
  maxRetries: number = 2
): Promise<FloorAreaRecord[]> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const records = await fetchFloorAreasForPostcode(postcode);
    
    // If we got records or it's the last attempt, return
    if (records.length > 0 || attempt === maxRetries) {
      return records;
    }
    
    // Wait before retry (exponential backoff: 1s, 2s)
    const retryDelay = (attempt + 1) * 1000;
    logger.info(`📐 Retrying ${postcode} in ${retryDelay}ms (attempt ${attempt + 2}/${maxRetries + 1})`);
    await delay(retryDelay);
  }
  
  return [];
}

/**
 * Fetch floor areas with rate limiting
 * Fetches sequentially with 500ms delay to avoid 429 errors
 */
async function fetchFloorAreasWithRateLimit(
  postcodes: string[],
  delayMs: number = 500
): Promise<Map<string, FloorAreaRecord[]>> {
  const cache = new Map<string, FloorAreaRecord[]>();
  
  for (let i = 0; i < postcodes.length; i++) {
    const postcode = postcodes[i];
    
    // Add delay between requests (except first one)
    if (i > 0) {
      await delay(delayMs);
    }
    
    const records = await fetchFloorAreasWithRetry(postcode);
    cache.set(postcode, records);
  }
  
  return cache;
}

/**
 * Result from tiered enrichment
 */
export interface EnrichmentResult {
  comps: NormalizedComparable[];
  apiCallsMade: number;
  tier: 1 | 2 | 3;  // 1 = subject only, 2 = escalated, 3 = desk review triggered
  compsWithFloorArea: number;
}

/**
 * Normalize a postcode to standard format "AB1 2CD"
 */
function normalizePostcode(postcode: string): string {
  const clean = postcode.toUpperCase().replace(/\s+/g, '');
  if (clean.length >= 5) {
    const outward = clean.slice(0, -3);
    const inward = clean.slice(-3);
    return `${outward} ${inward}`;
  }
  return postcode.toUpperCase();
}

/**
 * Apply floor area data to comparables
 */
function applyFloorAreasToComps(
  comps: NormalizedComparable[],
  floorAreas: FloorAreaRecord[]
): { enriched: NormalizedComparable[]; count: number } {
  let enrichedCount = 0;
  
  const enriched = comps.map((comp) => {
    // Skip if already has floor area
    if (comp.floorAreaSqm && comp.floorAreaSqm > 0) {
      enrichedCount++;
      return comp;
    }
    
    const match = findBestFloorAreaMatch(comp, floorAreas);
    
    if (match) {
      const floorAreaSqm = Math.round(match.square_feet * SQ_FT_TO_SQ_M);
      const floorAreaSqft = match.square_feet;
      enrichedCount++;
      
      // Recalculate price per sqm/sqft
      const pricePerSqm = Math.round(comp.salePrice / floorAreaSqm);
      const pricePerSqft = Math.round(comp.salePrice / floorAreaSqft);
      
      return {
        ...comp,
        floorAreaSqm,
        pricePerSqm,
        pricePerSqft,
      };
    }
    
    return comp;
  });
  
  return { enriched, count: enrichedCount };
}

/**
 * Enrich comparables with floor area data using TIERED API calls
 * 
 * TIERED APPROACH:
 * - Tier 1 (Default): Fetch floor areas for subject postcode ONLY (1 API call)
 *   If we get enough comps with floor area (>=4), stop here.
 * 
 * - Tier 2 (Escalation): If <4 comps with floor area, fetch additional postcodes
 *   where comps exist (up to 3 more = 4 total max).
 * 
 * - Tier 3: If still insufficient after max calls, proceed to valuation
 *   (may trigger desk review later based on confidence).
 * 
 * GOAL: 80-90% of valuations complete with only 1-2 API calls.
 * 
 * @param comps - Normalized comparables without floor area
 * @param subjectPostcode - Subject property postcode
 * @returns Enrichment result with stats
 */
export async function enrichWithFloorAreaTiered(
  comps: NormalizedComparable[],
  subjectPostcode: string
): Promise<EnrichmentResult> {
  const { apiTiers } = config;
  
  if (comps.length === 0) {
    return { comps, apiCallsMade: 0, tier: 1, compsWithFloorArea: 0 };
  }
  
  logger.info(`📐 [TIERED] Enriching ${comps.length} comps (Tier 1: subject postcode only)`);
  
  const normalizedSubject = normalizePostcode(subjectPostcode);
  let apiCallsMade = 0;
  let allFloorAreas: FloorAreaRecord[] = [];
  let enrichedComps = [...comps];
  let compsWithFloorArea = 0;
  
  // ============================================
  // TIER 1: Subject postcode only (1 API call)
  // ============================================
  const tier1Records = await fetchFloorAreasWithRetry(normalizedSubject);
  apiCallsMade++;
  allFloorAreas.push(...tier1Records);
  
  logger.info(`📐 [TIER 1] ${normalizedSubject}: ${tier1Records.length} floor area records (${apiCallsMade} API call)`);
  
  // Apply floor areas to comps
  const tier1Result = applyFloorAreasToComps(enrichedComps, allFloorAreas);
  enrichedComps = tier1Result.enriched;
  compsWithFloorArea = tier1Result.count;
  
  logger.info(`📐 [TIER 1] Result: ${compsWithFloorArea}/${comps.length} comps have floor area`);
  
  // Check if Tier 1 is sufficient
  if (compsWithFloorArea >= apiTiers.tier1MinComps) {
    logger.info(`📐 ✅ TIER 1 SUCCESS: ${compsWithFloorArea} comps with floor area (target: ${apiTiers.tier1MinComps})`);
    return {
      comps: enrichedComps,
      apiCallsMade,
      tier: 1,
      compsWithFloorArea,
    };
  }
  
  // ============================================
  // TIER 2: Escalation - fetch additional postcodes
  // ============================================
  logger.info(`📐 [TIER 2] Escalating: only ${compsWithFloorArea} comps (need ${apiTiers.tier1MinComps})`);
  
  // Find postcodes of comps that DON'T have floor area yet
  const compsNeedingFloorArea = enrichedComps.filter(c => !c.floorAreaSqm || c.floorAreaSqm === 0);
  const additionalPostcodes = new Set<string>();
  
  for (const comp of compsNeedingFloorArea) {
    const compPostcode = extractPostcodeFromAddress(comp.address) || comp.postcode;
    if (compPostcode) {
      const normalized = normalizePostcode(compPostcode);
      // Don't re-fetch subject postcode
      if (normalized !== normalizedSubject) {
        additionalPostcodes.add(normalized);
      }
    }
  }
  
  // Limit to max additional postcodes (respecting API call cap)
  const remainingCalls = apiTiers.maxFloorAreaCalls - apiCallsMade;
  const postcodesToFetch = Array.from(additionalPostcodes).slice(0, Math.min(apiTiers.tier2MaxPostcodes, remainingCalls));
  
  if (postcodesToFetch.length > 0) {
    logger.info(`📐 [TIER 2] Fetching ${postcodesToFetch.length} additional postcode(s): ${postcodesToFetch.join(', ')}`);
    
    // Fetch with rate limiting
    for (const postcode of postcodesToFetch) {
      // Check if we've hit the cap
      if (apiCallsMade >= apiTiers.maxFloorAreaCalls) {
        logger.warn(`📐 [TIER 2] API call cap reached (${apiCallsMade}/${apiTiers.maxFloorAreaCalls})`);
        break;
      }
      
      // Rate limit delay
      await delay(apiTiers.delayBetweenCallsMs);
      
      const records = await fetchFloorAreasWithRetry(postcode);
      apiCallsMade++;
      allFloorAreas.push(...records);
      
      logger.info(`📐 [TIER 2] ${postcode}: ${records.length} records (${apiCallsMade} total API calls)`);
      
      // Re-apply all floor areas
      const result = applyFloorAreasToComps(enrichedComps, allFloorAreas);
      enrichedComps = result.enriched;
      compsWithFloorArea = result.count;
      
      // Check if we now have enough
      if (compsWithFloorArea >= apiTiers.tier1MinComps) {
        logger.info(`📐 ✅ TIER 2 SUCCESS: ${compsWithFloorArea} comps with floor area after ${apiCallsMade} calls`);
        return {
          comps: enrichedComps,
          apiCallsMade,
          tier: 2,
          compsWithFloorArea,
        };
      }
    }
  }
  
  // ============================================
  // TIER 3: Insufficient data - proceed anyway
  // ============================================
  logger.warn(`📐 ⚠️ TIER 3: Only ${compsWithFloorArea} comps after ${apiCallsMade} API calls (may trigger desk review)`);
  
  return {
    comps: enrichedComps,
    apiCallsMade,
    tier: 3,
    compsWithFloorArea,
  };
}

/**
 * Legacy function - wraps tiered enrichment for backwards compatibility
 * 
 * @deprecated Use enrichWithFloorAreaTiered for new code
 */
export async function enrichWithFloorArea(
  comps: NormalizedComparable[],
  subjectPostcode: string
): Promise<NormalizedComparable[]> {
  const result = await enrichWithFloorAreaTiered(comps, subjectPostcode);
  return result.comps;
}

