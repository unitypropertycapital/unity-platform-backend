/**
 * UK Government EPC Open Data API Service
 * 
 * Fetches detailed EPC certificate data including:
 * - CONSTRUCTION_AGE_BAND (e.g., "1967-1975")
 * - FLAT_STOREY_COUNT (number of floors in building for flats)
 * 
 * API Documentation: https://epc.opendatacommunities.org/docs/api
 * 
 * AUTHENTICATION REQUIRED:
 * Register for free at https://epc.opendatacommunities.org/
 * Set environment variables: GOV_EPC_API_KEY and GOV_EPC_EMAIL
 */

import { httpRequest } from '../utils/httpClient';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

const BASE_URL = 'https://epc.opendatacommunities.org/api/v1';
const TIMEOUT = 8000; // Slightly longer timeout for government API

/**
 * EPC certificate data from UK Government API
 */
export interface GovEpcData {
  constructionAgeBand: string | null;
  flatStoreyCount: number | null;
  propertyType: string | null;
  builtForm: string | null;
  floorLevel: string | null;
  totalFloorArea: number | null;
  currentEnergyRating: string | null;
  uprn: string | null;
  address: string | null;
}

/**
 * Result from Gov EPC lookup
 */
export type GovEpcResult =
  | { success: true; data: GovEpcData }
  | { success: false; error: string };

/**
 * Raw response from EPC API domestic search
 */
interface EpcApiCertificate {
  'construction-age-band'?: string;
  'flat-storey-count'?: string;
  'property-type'?: string;
  'built-form'?: string;
  'floor-level'?: string;
  'total-floor-area'?: string;
  'current-energy-rating'?: string;
  uprn?: string;
  address?: string;
  address1?: string;
  address2?: string;
  postcode?: string;
}

interface EpcApiSearchResponse {
  rows?: EpcApiCertificate[];
  'column-names'?: string[];
}

/**
 * Parse construction age band to determine if it's in the 1950-1983 range
 * Used for ex-LA detection
 */
export function isConstructionAge1950to1983(ageBand: string | null): boolean {
  if (!ageBand) return false;
  
  // Common age bands: "1950-1966", "1967-1975", "1976-1982", "1983-1990", etc.
  const match = ageBand.match(/(\d{4})/);
  if (!match) return false;
  
  const startYear = parseInt(match[1], 10);
  return startYear >= 1950 && startYear <= 1983;
}

/**
 * Get authorization header for EPC API
 * Uses Basic auth with email:api_key format
 */
function getAuthHeader(): string | null {
  const apiKey = config.govEpcApiKey;
  const email = config.govEpcEmail;
  
  if (!apiKey || !email) {
    return null;
  }
  
  // Basic auth format: base64(email:api_key)
  const credentials = Buffer.from(`${email}:${apiKey}`).toString('base64');
  return `Basic ${credentials}`;
}

/**
 * Search for EPC certificate by postcode and address
 * Requires authentication - register at https://epc.opendatacommunities.org/
 */
async function searchByPostcode(
  postcode: string,
  addressLine1: string
): Promise<GovEpcResult> {
  const authHeader = getAuthHeader();
  
  if (!authHeader) {
    logger.debug('Gov EPC API not configured - skipping lookup');
    return { success: false, error: 'Gov EPC API credentials not configured' };
  }
  
  const cleanPostcode = postcode.replace(/\s/g, '');
  const encodedPostcode = encodeURIComponent(cleanPostcode);
  
  const url = `${BASE_URL}/domestic/search?postcode=${encodedPostcode}&size=100`;
  
  logger.info('Fetching Gov EPC data', { postcode: cleanPostcode });
  
  const result = await httpRequest<EpcApiSearchResponse>(url, {
    timeout: TIMEOUT,
    headers: {
      Accept: 'application/json',
      Authorization: authHeader,
    },
  });
  
  if (!result.success) {
    logger.warn('Gov EPC API request failed', { error: result.error.message });
    return { success: false, error: result.error.message };
  }
  
  const response = result.response.data;
  
  if (!response.rows || response.rows.length === 0) {
    logger.debug('No EPC certificates found for postcode', { postcode });
    return { success: false, error: 'No certificates found' };
  }
  
  // Find best match by address
  const bestMatch = findBestAddressMatch(response.rows, addressLine1);
  
  if (!bestMatch) {
    logger.debug('No matching EPC certificate for address', { addressLine1 });
    return { success: false, error: 'No matching certificate found' };
  }
  
  return {
    success: true,
    data: parseEpcCertificate(bestMatch),
  };
}

/**
 * Search for EPC certificate by UPRN (more reliable if available)
 * Requires authentication - register at https://epc.opendatacommunities.org/
 */
async function searchByUprn(uprn: string): Promise<GovEpcResult> {
  const authHeader = getAuthHeader();
  
  if (!authHeader) {
    logger.debug('Gov EPC API not configured - skipping lookup');
    return { success: false, error: 'Gov EPC API credentials not configured' };
  }
  
  const url = `${BASE_URL}/domestic/search?uprn=${encodeURIComponent(uprn)}&size=1`;
  
  logger.info('Fetching Gov EPC data by UPRN', { uprn });
  
  const result = await httpRequest<EpcApiSearchResponse>(url, {
    timeout: TIMEOUT,
    headers: {
      Accept: 'application/json',
      Authorization: authHeader,
    },
  });
  
  if (!result.success) {
    logger.warn('Gov EPC API request failed', { error: result.error.message });
    return { success: false, error: result.error.message };
  }
  
  const response = result.response.data;
  
  if (!response.rows || response.rows.length === 0) {
    logger.debug('No EPC certificate found for UPRN', { uprn });
    return { success: false, error: 'No certificate found' };
  }
  
  return {
    success: true,
    data: parseEpcCertificate(response.rows[0]),
  };
}

/**
 * Parse raw EPC certificate to structured data
 */
function parseEpcCertificate(cert: EpcApiCertificate): GovEpcData {
  // Parse flat storey count - usually empty, so we also check floor-level
  let flatStoreyCount: number | null = null;
  
  // First try flat-storey-count (rarely populated)
  if (cert['flat-storey-count']) {
    const parsed = parseInt(cert['flat-storey-count'], 10);
    if (!isNaN(parsed)) {
      flatStoreyCount = parsed;
    }
  }
  
  // If empty, infer from floor-level (e.g., "20+", "18", "Ground")
  // A flat on floor 7+ indicates a high-rise building
  if (!flatStoreyCount && cert['floor-level']) {
    const floorLevel = cert['floor-level'];
    // Handle "20+" format
    const match = floorLevel.match(/(\d+)/);
    if (match) {
      const floor = parseInt(match[1], 10);
      // Use floor level as proxy for building height (building has at least this many floors)
      if (!isNaN(floor) && floor >= 1) {
        flatStoreyCount = floor;
      }
    }
  }
  
  // Parse total floor area
  let totalFloorArea: number | null = null;
  if (cert['total-floor-area']) {
    const parsed = parseFloat(cert['total-floor-area']);
    if (!isNaN(parsed)) {
      totalFloorArea = parsed;
    }
  }
  
  return {
    constructionAgeBand: cert['construction-age-band'] || null,
    flatStoreyCount,
    propertyType: cert['property-type'] || null,
    builtForm: cert['built-form'] || null,
    floorLevel: cert['floor-level'] || null,
    totalFloorArea,
    currentEnergyRating: cert['current-energy-rating'] || null,
    uprn: cert.uprn || null,
    address: buildAddress(cert),
  };
}

/**
 * Build full address from certificate fields
 */
function buildAddress(cert: EpcApiCertificate): string | null {
  const parts = [
    cert.address1,
    cert.address2,
    cert.postcode,
  ].filter(Boolean);
  
  return parts.length > 0 ? parts.join(', ') : cert.address || null;
}

/**
 * Find best matching certificate by address
 * 
 * For flats, we try to match by:
 * 1. Exact flat number (Flat 120 = Flat 120)
 * 2. Same building name (any flat in Sudbury House)
 * 
 * This is because construction age and floor count apply to the whole building.
 */
function findBestAddressMatch(
  certs: EpcApiCertificate[],
  addressLine1: string
): EpcApiCertificate | null {
  const normalizedInput = normalizeAddress(addressLine1);
  
  // Extract building name from input (e.g., "Sudbury House" from "Flat 120 Sudbury House")
  const inputBuildingName = extractBuildingName(addressLine1);
  
  // Score each certificate
  let bestMatch: EpcApiCertificate | null = null;
  let bestScore = 0;
  
  for (const cert of certs) {
    const certAddress = cert.address1 || cert.address || '';
    const certAddress2 = cert.address2 || '';
    const normalizedCert = normalizeAddress(certAddress);
    
    let score = calculateMatchScore(normalizedInput, normalizedCert);
    
    // If exact match failed, check if it's the same building
    // Building name is often in address2 (e.g., "Sudbury House")
    if (score < 50 && inputBuildingName) {
      const certBuildingName = normalizeAddress(certAddress2);
      if (certBuildingName && certBuildingName.includes(inputBuildingName)) {
        // Same building! Use this certificate for building-level data
        score = 60;
      }
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = cert;
    }
  }
  
  // Require minimum match quality
  return bestScore >= 50 ? bestMatch : null;
}

/**
 * Extract building name from address (for flats)
 * E.g., "Flat 120 Sudbury House" -> "sudbury house"
 */
function extractBuildingName(address: string): string | null {
  // Remove "Flat X" prefix
  const withoutFlat = address.replace(/^flat\s+\d+[a-z]?\s*/i, '').trim();
  if (withoutFlat && withoutFlat !== address) {
    return normalizeAddress(withoutFlat);
  }
  return null;
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
 * Calculate match score between addresses
 */
function calculateMatchScore(addr1: string, addr2: string): number {
  // Exact match
  if (addr1 === addr2) return 100;
  
  // One contains the other
  if (addr1.includes(addr2) || addr2.includes(addr1)) return 80;
  
  // Extract building number and compare
  const num1 = extractBuildingNumber(addr1);
  const num2 = extractBuildingNumber(addr2);
  
  if (num1 && num2 && num1 === num2) {
    // Same building number, check street
    const street1 = addr1.replace(/^\d+[a-z]?\s*/i, '');
    const street2 = addr2.replace(/^\d+[a-z]?\s*/i, '');
    
    if (street1.includes(street2) || street2.includes(street1)) {
      return 70;
    }
    return 50;
  }
  
  return 0;
}

/**
 * Extract building number from address
 */
function extractBuildingNumber(address: string): string | null {
  const patterns = [
    /^flat\s+(\d+)/i,
    /^(\d+[a-z]?)\s/i,
    /,\s*(\d+[a-z]?)\s/i,
  ];
  
  for (const pattern of patterns) {
    const match = address.match(pattern);
    if (match) return match[1].toLowerCase();
  }
  
  return null;
}

/**
 * Get detailed EPC data including construction age and floor count
 * 
 * Tries UPRN first (more reliable), falls back to postcode search
 * 
 * @param uprn - Unique Property Reference Number
 * @param postcode - Property postcode
 * @param addressLine1 - First line of address
 */
export async function getGovEpcData(
  uprn: string | null,
  postcode: string,
  addressLine1: string
): Promise<GovEpcResult> {
  // Try UPRN lookup first if available
  if (uprn) {
    const uprnResult = await searchByUprn(uprn);
    if (uprnResult.success) {
      logger.info('Gov EPC data found via UPRN', {
        uprn,
        constructionAgeBand: uprnResult.data.constructionAgeBand,
        flatStoreyCount: uprnResult.data.flatStoreyCount,
      });
      return uprnResult;
    }
  }
  
  // Fall back to postcode search
  const postcodeResult = await searchByPostcode(postcode, addressLine1);
  
  if (postcodeResult.success) {
    logger.info('Gov EPC data found via postcode', {
      postcode,
      constructionAgeBand: postcodeResult.data.constructionAgeBand,
      flatStoreyCount: postcodeResult.data.flatStoreyCount,
    });
  }
  
  return postcodeResult;
}

/**
 * Create default/empty EPC data when API is not available
 */
export function getDefaultGovEpcData(): GovEpcData {
  return {
    constructionAgeBand: null,
    flatStoreyCount: null,
    propertyType: null,
    builtForm: null,
    floorLevel: null,
    totalFloorArea: null,
    currentEnergyRating: null,
    uprn: null,
    address: null,
  };
}







