/**
 * Comparable Normalizer
 * Converts raw data from different sources to normalized schema
 * Handles deduplication and calculated fields
 */

import { calculateDistanceMiles } from './distance';
import type { RawComparable, NormalizedComparable } from '../../types/comparable';
import type { LandRegistrySale } from '../../services/landRegistry';
import type { PropertyDataSoldPrice } from '../../services/propertyData';

// Square meters to square feet conversion factor
const SQM_TO_SQFT = 10.7639;

/**
 * Calculate age in months from a date string
 */
export function calculateAgeMonths(saleDateStr: string): number {
  const saleDate = new Date(saleDateStr);
  const now = new Date();
  
  const yearDiff = now.getFullYear() - saleDate.getFullYear();
  const monthDiff = now.getMonth() - saleDate.getMonth();
  
  return yearDiff * 12 + monthDiff;
}

/**
 * Calculate price per square meter
 */
export function calculatePricePerSqm(
  salePrice: number,
  floorAreaSqm: number | null
): number | null {
  if (!floorAreaSqm || floorAreaSqm <= 0) {
    return null;
  }
  return Math.round(salePrice / floorAreaSqm);
}

/**
 * Calculate price per square foot
 */
export function calculatePricePerSqft(
  salePrice: number,
  floorAreaSqm: number | null
): number | null {
  if (!floorAreaSqm || floorAreaSqm <= 0) {
    return null;
  }
  const floorAreaSqft = floorAreaSqm * SQM_TO_SQFT;
  return Math.round(salePrice / floorAreaSqft);
}

/**
 * Normalize property type string to standard format
 */
export function normalizePropertyType(type: string | undefined | null): string {
  if (!type || typeof type !== 'string') {
    return 'unknown';
  }
  
  const normalized = type.toLowerCase().trim();
  
  // Map various property type strings to standard types
  if (normalized.includes('flat') || normalized.includes('apartment') || normalized.includes('maisonette')) {
    return 'flat';
  }
  if (normalized.includes('terraced') || normalized.includes('terrace')) {
    return 'terraced';
  }
  if (normalized.includes('semi-detached') || normalized.includes('semi detached')) {
    return 'semi-detached';
  }
  if (normalized.includes('detached') && !normalized.includes('semi')) {
    return 'detached';
  }
  if (normalized.includes('bungalow')) {
    return 'bungalow';
  }
  if (normalized.includes('house')) {
    return 'house';
  }
  
  return normalized || 'unknown';
}

/**
 * Convert Land Registry sale to raw comparable
 */
export function fromLandRegistry(sale: LandRegistrySale): RawComparable {
  return {
    address: sale.address,
    postcode: sale.postcode,
    salePrice: sale.price,
    saleDate: sale.date,
    propertyType: normalizePropertyType(sale.propertyType),
    latitude: sale.latitude,
    longitude: sale.longitude,
    floorAreaSqm: null, // LR doesn't include floor area
    source: 'LR',
  };
}

/**
 * Convert PropertyData sold price to raw comparable
 * Handles missing/undefined fields gracefully
 */
export function fromPropertyData(sale: PropertyDataSoldPrice): RawComparable {
  // Safely parse coordinates
  const lat = sale.lat ? parseFloat(String(sale.lat)) : 0;
  const lng = sale.lng ? parseFloat(String(sale.lng)) : 0;
  
  return {
    address: sale.address || 'Unknown address',
    postcode: sale.postcode || '',
    salePrice: sale.price || 0,
    saleDate: sale.date || new Date().toISOString().split('T')[0],
    propertyType: normalizePropertyType(sale.type),
    latitude: isNaN(lat) ? 0 : lat,
    longitude: isNaN(lng) ? 0 : lng,
    floorAreaSqm: null, // Will be enriched separately if available
    source: 'PD',
  };
}

/**
 * Normalize a raw comparable by adding calculated fields
 */
export function normalizeComparable(
  raw: RawComparable,
  subjectLat: number,
  subjectLon: number
): NormalizedComparable {
  const distanceMiles = calculateDistanceMiles(
    subjectLat,
    subjectLon,
    raw.latitude,
    raw.longitude
  );
  
  return {
    ...raw,
    distanceMiles,
    pricePerSqm: calculatePricePerSqm(raw.salePrice, raw.floorAreaSqm),
    pricePerSqft: calculatePricePerSqft(raw.salePrice, raw.floorAreaSqm),
    ageMonths: calculateAgeMonths(raw.saleDate),
  };
}

/**
 * Create a unique key for deduplication
 * Uses address + sale date to identify unique sales
 */
function createDedupeKey(comp: RawComparable): string {
  const address = comp.address || '';
  const normalizedAddress = address.toLowerCase().replace(/\s+/g, ' ').trim();
  return `${normalizedAddress}|${comp.saleDate || ''}`;
}

/**
 * Deduplicate and merge comparables from multiple sources
 * Prefers LR source over PD when duplicates are found
 */
export function deduplicateComparables(comps: RawComparable[]): RawComparable[] {
  const seen = new Map<string, RawComparable>();
  
  // Sort by source priority (LR first) so LR entries are preferred
  const sorted = [...comps].sort((a, b) => {
    if (a.source === 'LR' && b.source === 'PD') return -1;
    if (a.source === 'PD' && b.source === 'LR') return 1;
    return 0;
  });
  
  for (const comp of sorted) {
    const key = createDedupeKey(comp);
    if (!seen.has(key)) {
      seen.set(key, comp);
    }
  }
  
  return Array.from(seen.values());
}

/**
 * Process and normalize a batch of comparables
 */
export function processComparables(
  rawComps: RawComparable[],
  subjectLat: number,
  subjectLon: number
): NormalizedComparable[] {
  // Deduplicate first
  const deduped = deduplicateComparables(rawComps);
  
  // Normalize each comparable
  return deduped.map((raw) => normalizeComparable(raw, subjectLat, subjectLon));
}

