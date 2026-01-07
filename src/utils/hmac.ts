/**
 * HMAC Verification Utility
 * Verifies request signatures to ensure requests come from authorized sources
 */

import crypto from 'crypto';
import { config } from './config';
import { logger } from './logger';

/**
 * Fields to include in HMAC calculation (in order)
 * Must match what the frontend uses to generate the signature
 */
const HMAC_FIELDS = [
  'addressLine1',
  'postcode',
  'propertyType',
  'saleTimeline',
  'consent',
] as const;

/**
 * Generate HMAC signature for a request payload
 * Used for testing and frontend reference
 */
export function generateHmac(payload: Record<string, unknown>): string {
  const secret = config.hmacSecret;
  
  if (!secret) {
    throw new Error('HMAC_SECRET not configured');
  }

  // Build the string to sign from specific fields in order
  const dataToSign = HMAC_FIELDS
    .map(field => String(payload[field] ?? ''))
    .join('|');

  return crypto
    .createHmac('sha256', secret)
    .update(dataToSign)
    .digest('hex');
}

/**
 * Verify HMAC signature from request
 * Returns true if signature is valid
 */
export function verifyHmac(
  payload: Record<string, unknown>,
  providedSignature: string
): boolean {
  // If HMAC verification is disabled (development mode), accept all
  if (!config.hmacSecret) {
    logger.warn('HMAC verification skipped - HMAC_SECRET not configured');
    return true;
  }

  // If no signature provided, reject
  if (!providedSignature || typeof providedSignature !== 'string') {
    logger.warn('HMAC verification failed - no signature provided');
    return false;
  }

  try {
    const expectedSignature = generateHmac(payload);
    
    // Use timing-safe comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(providedSignature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );

    if (!isValid) {
      logger.warn('HMAC verification failed - signature mismatch', {
        provided: providedSignature.substring(0, 8) + '...',
        expected: expectedSignature.substring(0, 8) + '...',
      });
    }

    return isValid;
  } catch (err) {
    logger.error('HMAC verification error', { error: (err as Error).message });
    return false;
  }
}

/**
 * HMAC verification result
 */
export interface HmacVerificationResult {
  valid: boolean;
  error?: string;
}

/**
 * Verify HMAC with detailed result
 */
export function verifyHmacWithDetails(
  payload: Record<string, unknown>,
  providedSignature: string
): HmacVerificationResult {
  // If HMAC verification is disabled (development mode), accept all
  if (!config.hmacSecret) {
    return { valid: true };
  }

  if (!providedSignature || typeof providedSignature !== 'string') {
    return { valid: false, error: 'No HMAC signature provided' };
  }

  if (providedSignature.length !== 64) {
    return { valid: false, error: 'Invalid HMAC signature format' };
  }

  try {
    const expectedSignature = generateHmac(payload);
    
    const isValid = crypto.timingSafeEqual(
      Buffer.from(providedSignature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );

    if (!isValid) {
      return { valid: false, error: 'HMAC signature verification failed' };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: 'HMAC verification error' };
  }
}

