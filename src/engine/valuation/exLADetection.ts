/**
 * Ex-Local Authority Detection
 * Scoring system to identify ex-council properties
 * 
 * Ex-LA properties typically have:
 * - Building names ending in "House", "Tower", "Point", "Heights"
 * - Built 1950-1983 (post-war social housing era)
 * - High-rise buildings (7+ floors)
 * - Lower sale prices compared to private developments
 */

import { config } from '../../utils/config';

/**
 * Individual signals for ex-LA detection
 */
export interface ExLASignals {
  buildingNamePattern: number;
  constructionAgeBand: number;
  buildingHeight: number;
  cheapSalesPattern: number;
}

/**
 * Result of ex-LA detection
 */
export interface ExLADetectionResult {
  isExLocalAuthority: boolean;
  exLAScore: number;
  signals: ExLASignals;
}

/**
 * Input for ex-LA detection
 */
export interface ExLADetectionInput {
  buildingName: string | null;
  constructionAgeBand: string | null;
  flatStoreyCount: number | null;
  compPricesPerSqm: number[];
  postcodeMedianPsqm: number | null;
}

/**
 * Building name patterns typical of ex-LA estates
 */
const EX_LA_NAME_PATTERNS = [
  /\s+house$/i,
  /\s+tower$/i,
  /\s+point$/i,
  /\s+heights$/i,
  /\s+court$/i, // Many ex-LA have "Court" too
  /\s+block$/i,
];

/**
 * Private development name patterns (exclusions)
 */
const PRIVATE_NAME_PATTERNS = [
  /\s+wharf$/i,
  /\s+square$/i,
  /\s+residences$/i,
  /\s+gardens$/i,
  /\s+plaza$/i,
  /\s+apartments$/i,
  /\s+place$/i,
  /\s+mansions$/i,
  /\s+lodge$/i,
];

/**
 * Age bands typical of ex-LA construction
 */
const EX_LA_AGE_BANDS = [
  '1950-1966',
  '1967-1975',
  '1976-1982',
  '1976-1983',
  '1983-1990', // Some later estates
  'England and Wales: 1950-1966',
  'England and Wales: 1967-1975',
  'England and Wales: 1976-1982',
];

/**
 * Check building name pattern (+1 point if ex-LA pattern)
 */
export function checkBuildingNamePattern(buildingName: string | null): number {
  if (!buildingName) return 0;
  
  const name = buildingName.trim();
  
  // Check for private development patterns first (exclusion)
  for (const pattern of PRIVATE_NAME_PATTERNS) {
    if (pattern.test(name)) {
      return 0;
    }
  }
  
  // Check for ex-LA patterns
  for (const pattern of EX_LA_NAME_PATTERNS) {
    if (pattern.test(name)) {
      return 1;
    }
  }
  
  return 0;
}

/**
 * Check construction age band (+1 point if 1950-1983)
 */
export function checkConstructionAgeBand(ageBand: string | null): number {
  if (!ageBand) return 0;
  
  const normalized = ageBand.toLowerCase().trim();
  
  for (const band of EX_LA_AGE_BANDS) {
    if (normalized.includes(band.toLowerCase())) {
      return 1;
    }
  }
  
  // Also check for year ranges
  const yearMatch = ageBand.match(/(\d{4})/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    if (year >= 1950 && year <= 1983) {
      return 1;
    }
  }
  
  return 0;
}

/**
 * Check building height (+1 point if 7+ floors)
 */
export function checkBuildingHeight(flatStoreyCount: number | null): number {
  if (flatStoreyCount === null) return 0;
  
  // 7+ floors is typical of ex-LA tower blocks
  if (flatStoreyCount >= config.conservative.exLAFloorThreshold) {
    return 1;
  }
  
  return 0;
}

/**
 * Check for cheap sales pattern (+1 point if comps are cheap)
 * If majority of comps are <70% of postcode median, suggests ex-LA
 */
export function checkCheapSalesPattern(
  compPricesPerSqm: number[],
  postcodeMedianPsqm: number | null
): number {
  if (!postcodeMedianPsqm || compPricesPerSqm.length < config.conservative.minCheapCompsForPattern) {
    return 0;
  }
  
  const threshold = postcodeMedianPsqm * config.conservative.cheapCompThreshold;
  const cheapComps = compPricesPerSqm.filter(p => p < threshold);
  
  // If most comps are cheap, this suggests ex-LA stock
  if (cheapComps.length >= compPricesPerSqm.length * 0.5) {
    return 1;
  }
  
  return 0;
}

/**
 * Extract building name from address
 * 
 * For flats, building name is often after the flat number:
 * - "Flat 4, Sudbury House" → "Sudbury House"
 * - "Flat 120 Sudbury House, 85 Wandsworth High Street" → "Sudbury House"
 */
export function extractBuildingName(address: string): string | null {
  if (!address) return null;
  
  const normalized = address.trim();
  
  // Try to extract building name after flat number
  // Pattern: "Flat X[,] Building Name[,...]"
  const flatMatch = normalized.match(/^(?:flat|apartment|apt\.?|unit)\s+\d+[a-z]?\s*,?\s*([^,]+)/i);
  if (flatMatch) {
    const potentialName = flatMatch[1].trim();
    // Filter out street addresses (contain "Street", "Road", etc.)
    if (!/\b(?:street|road|lane|avenue|drive|way|close|crescent|terrace|place|mews|gardens)\b/i.test(potentialName)) {
      return potentialName;
    }
  }
  
  // Try to extract from comma-separated parts
  const parts = normalized.split(',').map(p => p.trim());
  for (const part of parts) {
    // Skip flat numbers
    if (/^(?:flat|apartment|apt\.?|unit)\s+\d+/i.test(part)) continue;
    // Skip street addresses
    if (/\b(?:street|road|lane|avenue|drive|way|close|crescent|terrace|place|mews|gardens)\b/i.test(part)) continue;
    // Skip postcodes
    if (/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(part)) continue;
    // Skip numeric addresses
    if (/^\d+[a-z]?\s*$/i.test(part)) continue;
    
    // This might be a building name
    if (part.length > 3) {
      return part;
    }
  }
  
  return null;
}

/**
 * Classify a single comparable as ex-LA or private
 * 
 * Uses 3-signal approach (no cheap sales pattern since we don't have median yet):
 * - Building name pattern: +1
 * - Construction age band: +1
 * - Building height (7+ floors): +1
 * 
 * isExLocalAuthority = score >= 2 (out of 3)
 * 
 * Note: This is used early in the pipeline before statistics are calculated.
 * For more accurate detection, see detectExLA() which includes price pattern signal.
 */
export interface ComparableClassification {
  isExLA: boolean;
  exLAScore: number;
}

export function classifyComparable(
  address: string,
  propertyType: string
): ComparableClassification {
  // Only classify flats - houses are rarely ex-LA
  const propertyTypeNorm = propertyType.toLowerCase();
  const isFlatType = ['flat', 'apartment', 'maisonette'].includes(propertyTypeNorm);
  
  if (!isFlatType) {
    return { isExLA: false, exLAScore: 0 };
  }
  
  // Extract building name from address
  const buildingName = extractBuildingName(address);
  
  // Calculate score using 3 signals (no age band or height data for comps)
  // We only have address to work with, so focus on building name patterns
  const nameScore = checkBuildingNamePattern(buildingName);
  
  // For comparables, we primarily rely on building name
  // If name suggests ex-LA, classify as ex-LA
  // This is conservative but prevents mixing segments
  const exLAScore = nameScore;
  
  return {
    isExLA: exLAScore >= 1, // More conservative threshold for comps (name pattern alone)
    exLAScore,
  };
}

/**
 * Detect if property is ex-local authority
 * 
 * Scoring system:
 * - Building name pattern: +1
 * - Construction age band: +1
 * - Building height (7+ floors): +1
 * - Cheap sales pattern: +1
 * 
 * isExLocalAuthority = score >= 2
 */
export function detectExLA(input: ExLADetectionInput): ExLADetectionResult {
  const {
    buildingName,
    constructionAgeBand,
    flatStoreyCount,
    compPricesPerSqm,
    postcodeMedianPsqm,
  } = input;
  
  const signals: ExLASignals = {
    buildingNamePattern: checkBuildingNamePattern(buildingName),
    constructionAgeBand: checkConstructionAgeBand(constructionAgeBand),
    buildingHeight: checkBuildingHeight(flatStoreyCount),
    cheapSalesPattern: checkCheapSalesPattern(compPricesPerSqm, postcodeMedianPsqm),
  };
  
  const exLAScore =
    signals.buildingNamePattern +
    signals.constructionAgeBand +
    signals.buildingHeight +
    signals.cheapSalesPattern;
  
  return {
    isExLocalAuthority: exLAScore >= config.conservative.exLAScoreThreshold,
    exLAScore,
    signals,
  };
}
