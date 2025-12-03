/**
 * Address Cache Service
 * Handles caching of resolved addresses in Supabase
 */

import { getSupabaseClient } from './supabase';
import { logger } from '../utils/logger';
import type { CachedAddress, AddressInsertData } from '../types/address';

/**
 * Normalize postcode for cache lookup (trimmed, uppercase, no spaces)
 */
function normalizePostcode(postcode: string): string {
  return postcode.trim().toUpperCase().replace(/\s/g, '');
}

/**
 * Normalize house number for cache lookup (trimmed, lowercase)
 */
function normalizeHouseNumber(houseNumber: string): string {
  return houseNumber.trim().toLowerCase();
}

/**
 * Find a cached address by postcode and house number
 * Returns null if not found
 */
export async function findCachedAddress(
  postcode: string,
  houseNumber: string
): Promise<CachedAddress | null> {
  const normPostcode = normalizePostcode(postcode);
  const normHouseNumber = normalizeHouseNumber(houseNumber);

  logger.info('Looking up cached address', { postcode: normPostcode, houseNumber: normHouseNumber });

  const client = getSupabaseClient();

  const { data, error } = await client
    .from('addresses')
    .select('*')
    .eq('postcode', normPostcode) // Exact match on normalized postcode (no spaces)
    .ilike('house_number', normHouseNumber)
    .limit(1)
    .single();

  if (error) {
    // PGRST116 = no rows found - not an error
    if (error.code === 'PGRST116') {
      logger.info('Address not in cache', { postcode: normPostcode, houseNumber: normHouseNumber });
      return null;
    }

    logger.error('Error looking up cached address', { error: error.message });
    return null;
  }

  logger.info('Found cached address', { id: data.id, uprn: data.uprn });
  return data as CachedAddress;
}

/**
 * Find a cached address by ID
 */
export async function findCachedAddressById(id: string): Promise<CachedAddress | null> {
  logger.info('Looking up cached address by ID', { id });

  const client = getSupabaseClient();

  const { data, error } = await client
    .from('addresses')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      logger.warn('Address not found by ID', { id });
      return null;
    }

    logger.error('Error looking up address by ID', { error: error.message, id });
    return null;
  }

  return data as CachedAddress;
}

/**
 * Insert a new address into the cache
 * Returns the inserted row
 */
export async function cacheAddress(addressData: AddressInsertData): Promise<CachedAddress | null> {
  logger.info('Caching address', {
    postcode: addressData.postcode,
    houseNumber: addressData.house_number,
  });

  const client = getSupabaseClient();

  const { data, error } = await client
    .from('addresses')
    .insert(addressData)
    .select()
    .single();

  if (error) {
    // Handle unique constraint violation (address already exists)
    if (error.code === '23505') {
      logger.warn('Address already cached (race condition), fetching existing', {
        postcode: addressData.postcode,
        houseNumber: addressData.house_number,
      });
      return findCachedAddress(addressData.postcode, addressData.house_number);
    }

    logger.error('Error caching address', { error: error.message });
    return null;
  }

  logger.info('Address cached successfully', { id: data.id });
  return data as CachedAddress;
}

/**
 * Map Ideal Postcodes response to address insert data
 */
export function mapIdealPostcodesToAddressData(
  idealAddress: {
    line_1?: string;
    line_2?: string;
    post_town?: string;
    county?: string;
    country?: string;
    uprn?: string;
    udprn?: string;
    latitude?: number;
    longitude?: number;
    building_number?: string;
    building_name?: string;
  },
  postcode: string,
  houseNumber: string,
  providerRaw: Record<string, unknown>
): AddressInsertData {
  return {
    // Normalize postcode: uppercase, no spaces (for consistent cache lookups)
    postcode: postcode.trim().toUpperCase().replace(/\s/g, ''),
    house_number: houseNumber.trim().toLowerCase(),
    address_line_1: idealAddress.line_1 || null,
    address_line_2: idealAddress.line_2 || null,
    town: idealAddress.post_town || null,
    county: idealAddress.county || null,
    country: idealAddress.country || 'UK',
    uprn: idealAddress.uprn || null,
    udprn: idealAddress.udprn || null,
    latitude: idealAddress.latitude || null,
    longitude: idealAddress.longitude || null,
    provider_raw: providerRaw,
  };
}
