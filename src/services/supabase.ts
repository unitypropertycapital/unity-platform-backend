import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import type { HealthCheckResult } from '../types/services';

let supabaseInstance: SupabaseClient | null = null;

/**
 * Get or create Supabase client singleton
 */
export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    if (!config.supabaseUrl || !config.supabaseServiceKey) {
      throw new Error('Supabase configuration missing');
    }

    supabaseInstance = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    logger.info('Supabase client initialized');
  }

  return supabaseInstance;
}

/**
 * Health check for Supabase connection
 */
export async function healthCheck(): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    const client = getSupabaseClient();

    // Simple query to test connection - just check if we can connect
    const { error } = await client.from('valuations').select('id').limit(1);

    const latencyMs = Date.now() - start;

    if (error) {
      // Table might not exist yet, but connection works
      if (error.code === '42P01') {
        // relation does not exist
        logger.warn('Supabase connected but valuations table not found - setup pending');
        return { ok: true, latencyMs };
      }

      // Permission error is OK - means connection works but RLS is active
      if (error.code === 'PGRST301') {
        return { ok: true, latencyMs };
      }

      return { ok: false, latencyMs, error: error.message };
    }

    return { ok: true, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return { ok: false, latencyMs, error: (err as Error).message };
  }
}

