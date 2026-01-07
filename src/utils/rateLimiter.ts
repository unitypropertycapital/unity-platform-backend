/**
 * Rate Limiter
 * Limits requests per IP address using Supabase for persistence
 * Works with serverless functions (Vercel)
 */

import { getSupabaseClient } from '../services/supabase';
import { config } from './config';
import { logger } from './logger';

/**
 * Rate limit configuration
 */
interface RateLimitConfig {
  maxRequests: number;      // Maximum requests allowed
  windowMs: number;         // Time window in milliseconds
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds?: number;
}

/**
 * Default rate limit: 10 requests per hour per IP
 */
const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '10', 10),
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || String(60 * 60 * 1000), 10), // 1 hour
};

/**
 * Check rate limit for an IP address
 * Uses Supabase to track request counts (persists across serverless invocations)
 */
export async function checkRateLimit(
  ip: string,
  endpoint: string = 'valuation',
  customConfig?: Partial<RateLimitConfig>
): Promise<RateLimitResult> {
  const conf = { ...DEFAULT_CONFIG, ...customConfig };
  const windowStart = new Date(Date.now() - conf.windowMs);
  const resetAt = new Date(Date.now() + conf.windowMs);

  // Skip rate limiting if disabled
  if (conf.maxRequests <= 0) {
    return { allowed: true, remaining: Infinity, resetAt };
  }

  try {
    const supabase = getSupabaseClient();

    // Count requests from this IP in the current window
    const { count, error } = await supabase
      .from('rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('ip_address', ip)
      .eq('endpoint', endpoint)
      .gte('created_at', windowStart.toISOString());

    if (error) {
      // If rate_limits table doesn't exist, allow the request
      if (error.code === '42P01') {
        logger.warn('rate_limits table not found - rate limiting disabled');
        return { allowed: true, remaining: conf.maxRequests, resetAt };
      }
      logger.error('Rate limit check failed', { error: error.message });
      // On error, allow the request (fail open)
      return { allowed: true, remaining: conf.maxRequests, resetAt };
    }

    const requestCount = count || 0;
    const remaining = Math.max(0, conf.maxRequests - requestCount);
    const allowed = requestCount < conf.maxRequests;

    if (allowed) {
      // Log this request for rate limiting
      await supabase.from('rate_limits').insert({
        ip_address: ip,
        endpoint,
      });
    } else {
      // Calculate retry-after
      const { data: oldestRequest } = await supabase
        .from('rate_limits')
        .select('created_at')
        .eq('ip_address', ip)
        .eq('endpoint', endpoint)
        .gte('created_at', windowStart.toISOString())
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      let retryAfterSeconds = Math.ceil(conf.windowMs / 1000);
      if (oldestRequest?.created_at) {
        const oldestTime = new Date(oldestRequest.created_at).getTime();
        const expiresAt = oldestTime + conf.windowMs;
        retryAfterSeconds = Math.ceil((expiresAt - Date.now()) / 1000);
      }

      logger.warn('Rate limit exceeded', { 
        ip, 
        endpoint, 
        requestCount, 
        maxRequests: conf.maxRequests,
        retryAfterSeconds 
      });

      return { 
        allowed: false, 
        remaining: 0, 
        resetAt,
        retryAfterSeconds 
      };
    }

    return { allowed, remaining, resetAt };
  } catch (err) {
    logger.error('Rate limiter error', { error: (err as Error).message });
    // On error, allow the request (fail open)
    return { allowed: true, remaining: conf.maxRequests, resetAt };
  }
}

/**
 * Get client IP from request
 * Handles various proxy headers
 */
export function getClientIp(req: {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}): string {
  // Check various headers that proxies use
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) 
      ? forwardedFor[0] 
      : forwardedFor.split(',')[0];
    return ips.trim();
  }

  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  const cfConnectingIp = req.headers['cf-connecting-ip'];
  if (cfConnectingIp) {
    return Array.isArray(cfConnectingIp) ? cfConnectingIp[0] : cfConnectingIp;
  }

  // Vercel specific
  const vercelForwardedFor = req.headers['x-vercel-forwarded-for'];
  if (vercelForwardedFor) {
    return Array.isArray(vercelForwardedFor) 
      ? vercelForwardedFor[0] 
      : vercelForwardedFor.split(',')[0].trim();
  }

  // Fallback to socket
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Clean up old rate limit records (run periodically)
 * Removes records older than the window
 */
export async function cleanupOldRateLimits(windowMs: number = DEFAULT_CONFIG.windowMs): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const cutoff = new Date(Date.now() - windowMs);

    const { error } = await supabase
      .from('rate_limits')
      .delete()
      .lt('created_at', cutoff.toISOString());

    if (error && error.code !== '42P01') {
      logger.error('Failed to cleanup rate limits', { error: error.message });
    }
  } catch (err) {
    logger.error('Rate limit cleanup error', { error: (err as Error).message });
  }
}

