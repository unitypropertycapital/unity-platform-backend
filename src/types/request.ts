import type { PropertyType } from './property';

export type SaleTimeline = '0-8_weeks' | '8-16_weeks' | '16+_weeks';

/**
 * @deprecated Use addressId instead. Will be removed in future version.
 * Pre-resolved address data from frontend (optional)
 * If provided, skips Ideal Postcodes API call in backend
 */
export interface PreResolvedAddress {
  uprn: string;
  latitude: number;
  longitude: number;
  line_1: string;
  line_2?: string;
  line_3?: string;
  post_town: string;
}

export interface ValuationRequest {
  addressLine1: string;
  addressLine2?: string;
  postcode: string;
  propertyType: PropertyType;
  saleTimeline: SaleTimeline;
  reasonForSelling: string;
  source: string;
  consent: boolean;
  hmac: string;

  /**
   * Recommended: UUID from /api/address/resolve
   * If provided, backend uses cached address data from Supabase
   * Never calls Ideal Postcodes directly
   */
  addressId?: string;

  /**
   * @deprecated Use addressId instead
   * Optional: Pre-resolved address from frontend Ideal Postcodes lookup
   * If provided, backend skips Ideal Postcodes API call (saves 1 API call)
   */
  resolvedAddress?: PreResolvedAddress;
}

export function isValidPropertyType(value: unknown): value is PropertyType {
  return value === 'house' || value === 'flat' || value === 'bungalow';
}

export function isValidSaleTimeline(value: unknown): value is SaleTimeline {
  return value === '0-8_weeks' || value === '8-16_weeks' || value === '16+_weeks';
}

/**
 * Check if a string is a valid UUID v4
 */
function isValidUUID(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

export function validateValuationRequest(
  body: unknown
): { valid: true; data: ValuationRequest } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be an object'] };
  }

  const data = body as Record<string, unknown>;

  // Check if addressId is provided (preferred method)
  const hasAddressId = typeof data.addressId === 'string' && data.addressId.trim();

  // Required string fields (addressLine1 & postcode still needed for EPC lookup)
  if (typeof data.addressLine1 !== 'string' || !data.addressLine1.trim()) {
    errors.push('addressLine1 is required');
  }

  if (typeof data.postcode !== 'string' || !data.postcode.trim()) {
    errors.push('postcode is required');
  }

  if (!isValidPropertyType(data.propertyType)) {
    errors.push('propertyType must be one of: house, flat, bungalow');
  }

  if (!isValidSaleTimeline(data.saleTimeline)) {
    errors.push('saleTimeline must be one of: 0-8_weeks, 8-16_weeks, 16+_weeks');
  }

  if (typeof data.reasonForSelling !== 'string') {
    errors.push('reasonForSelling is required');
  }

  if (typeof data.source !== 'string') {
    errors.push('source is required');
  }

  if (typeof data.consent !== 'boolean') {
    errors.push('consent must be a boolean');
  }

  if (typeof data.hmac !== 'string') {
    errors.push('hmac signature is required');
  }

  // Validate addressId format if provided
  if (hasAddressId && !isValidUUID(data.addressId)) {
    errors.push('addressId must be a valid UUID');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Parse optional pre-resolved address (deprecated)
  let resolvedAddress: PreResolvedAddress | undefined;
  if (data.resolvedAddress && typeof data.resolvedAddress === 'object') {
    const resolved = data.resolvedAddress as Record<string, unknown>;
    if (
      typeof resolved.uprn === 'string' &&
      typeof resolved.latitude === 'number' &&
      typeof resolved.longitude === 'number' &&
      typeof resolved.line_1 === 'string' &&
      typeof resolved.post_town === 'string'
    ) {
      resolvedAddress = {
        uprn: resolved.uprn,
        latitude: resolved.latitude,
        longitude: resolved.longitude,
        line_1: resolved.line_1,
        line_2: resolved.line_2 as string | undefined,
        line_3: resolved.line_3 as string | undefined,
        post_town: resolved.post_town,
      };
    }
  }

  return {
    valid: true,
    data: {
      addressLine1: data.addressLine1 as string,
      addressLine2: (data.addressLine2 as string) || '',
      postcode: data.postcode as string,
      propertyType: data.propertyType as PropertyType,
      saleTimeline: data.saleTimeline as SaleTimeline,
      reasonForSelling: data.reasonForSelling as string,
      source: data.source as string,
      consent: data.consent as boolean,
      hmac: data.hmac as string,
      addressId: hasAddressId ? (data.addressId as string) : undefined,
      resolvedAddress,
    },
  };
}
