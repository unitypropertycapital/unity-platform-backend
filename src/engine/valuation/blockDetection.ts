/**
 * Block Detection
 * Detects if a property is a flat within a block (vs house/semi/terrace)
 * 
 * This is important because block/ex-LA penalties only apply to flats
 */

/**
 * Result of block detection
 */
export interface BlockDetectionResult {
  isFlatBlock: boolean;
  reason: string;
}

/**
 * Address patterns that indicate a flat
 */
const FLAT_ADDRESS_PATTERNS = [
  /^flat\s+\d+[a-z]?/i,
  /^apartment\s+\d+[a-z]?/i,
  /^apt\.?\s+\d+[a-z]?/i,
  /^unit\s+\d+[a-z]?/i,
  /^\d+[a-z]?,?\s+flat/i,
];

/**
 * Property types that indicate a flat
 */
const FLAT_PROPERTY_TYPES = [
  'flat',
  'maisonette',
  'apartment',
  'studio',
  'penthouse',
];

/**
 * Detect if a property is a flat/block
 * 
 * Checks in order:
 * 1. Explicit propertyType from request (most reliable)
 * 2. EPC property type
 * 3. Address pattern (e.g., "Flat 4", "Apartment 12")
 * 
 * @param propertyType - Property type from request
 * @param addressLine1 - First line of address
 * @param epcPropertyType - Property type from EPC data
 * @returns Detection result with reason
 */
export function detectFlatBlock(
  propertyType: string,
  addressLine1: string,
  epcPropertyType: string | null
): BlockDetectionResult {
  const normalizedPropertyType = propertyType.toLowerCase().trim();
  const normalizedEpcPropertyType = epcPropertyType?.toLowerCase().trim();
  
  // Primary check: explicit property type
  if (FLAT_PROPERTY_TYPES.includes(normalizedPropertyType)) {
    return {
      isFlatBlock: true,
      reason: 'property_type_is_flat',
    };
  }
  
  // Secondary check: EPC property type
  if (normalizedEpcPropertyType && FLAT_PROPERTY_TYPES.includes(normalizedEpcPropertyType)) {
    return {
      isFlatBlock: true,
      reason: 'epc_property_type_is_flat',
    };
  }
  
  // Tertiary check: address pattern
  const normalizedAddress = addressLine1.toLowerCase().trim();
  for (const pattern of FLAT_ADDRESS_PATTERNS) {
    if (pattern.test(normalizedAddress)) {
      return {
        isFlatBlock: true,
        reason: 'address_pattern_is_flat',
      };
    }
  }
  
  // Not detected as flat
  return {
    isFlatBlock: false,
    reason: 'not_a_flat_block',
  };
}

/**
 * Check if a floor level string indicates a high floor
 * Used to infer building height when explicit floor count unavailable
 */
export function parseFloorLevel(floorLevel: string | null): number | null {
  if (!floorLevel) return null;
  
  const normalized = floorLevel.toLowerCase().trim();
  
  // Handle common formats
  if (normalized === 'ground') return 0;
  if (normalized === 'basement') return -1;
  if (normalized === 'ground floor') return 0;
  
  // Handle numeric ranges like "10-20" or "20+"
  const rangeMatch = normalized.match(/(\d+)[-+]/);
  if (rangeMatch) {
    return parseInt(rangeMatch[1], 10);
  }
  
  // Handle ordinal formats
  const ordinalMatch = normalized.match(/(\d+)(?:st|nd|rd|th)/);
  if (ordinalMatch) {
    return parseInt(ordinalMatch[1], 10);
  }
  
  // Handle simple numbers
  const simpleMatch = normalized.match(/^(\d+)$/);
  if (simpleMatch) {
    return parseInt(simpleMatch[1], 10);
  }
  
  return null;
}






