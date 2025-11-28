import type { PropertyType } from './property';

export type SaleTimeline = '0-8_weeks' | '8-16_weeks' | '16+_weeks';

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
}

export function isValidPropertyType(value: unknown): value is PropertyType {
  return value === 'house' || value === 'flat' || value === 'bungalow';
}

export function isValidSaleTimeline(value: unknown): value is SaleTimeline {
  return value === '0-8_weeks' || value === '8-16_weeks' || value === '16+_weeks';
}

export function validateValuationRequest(
  body: unknown
): { valid: true; data: ValuationRequest } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be an object'] };
  }

  const data = body as Record<string, unknown>;

  // Required string fields
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

  if (errors.length > 0) {
    return { valid: false, errors };
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
    },
  };
}

