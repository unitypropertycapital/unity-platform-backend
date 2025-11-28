import type { VercelRequest, VercelResponse } from '@vercel/node';
import { healthCheck as idealPostcodesHealth } from '../src/services/idealPostcodes';
import { healthCheck as propertyDataHealth } from '../src/services/propertyData';
import { healthCheck as streetViewHealth } from '../src/services/streetView';
import { healthCheck as supabaseHealth } from '../src/services/supabase';
import { healthCheck as onsHpiHealth } from '../src/services/onsHpi';
import { validateConfig } from '../src/utils/config';
import { logger } from '../src/utils/logger';
import { getRequestOrigin } from '../src/utils/requestOrigin';
import type { HealthCheckResponse, ServiceHealth } from '../src/types/services';

interface HealthCheckWithService {
  service: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

async function runHealthChecks(origin: string): Promise<ServiceHealth[]> {
  const checkPromises = [
    idealPostcodesHealth(origin).then((r) => ({ service: 'idealPostcodes', ...r })),
    propertyDataHealth().then((r) => ({ service: 'propertyData', ...r })),
    streetViewHealth().then((r) => ({ service: 'googleStreetView', ...r })),
    supabaseHealth().then((r) => ({ service: 'supabase', ...r })),
    onsHpiHealth().then((r) => ({ service: 'onsHpi', ...r })),
  ];

  const results = await Promise.allSettled(checkPromises);

  const serviceNames = ['idealPostcodes', 'propertyData', 'googleStreetView', 'supabase', 'onsHpi'];

  return results.map((result, index): ServiceHealth => {
    if (result.status === 'fulfilled') {
      const { service, ok, latencyMs, error } = result.value as HealthCheckWithService;
      return {
        service,
        status: ok ? 'ok' : 'error',
        latencyMs,
        message: error,
      };
    }

    return {
      service: serviceNames[index],
      status: 'error',
      latencyMs: 0,
      message: result.reason?.message || 'Unknown error',
    };
  });
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow GET
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Extract origin from request (for URL whitelist verification)
  const origin = getRequestOrigin(req);
  logger.info('Health check requested', { origin });

  // Check config first
  const configCheck = validateConfig();
  if (!configCheck.valid) {
    logger.error('Configuration invalid', { missing: configCheck.missing });
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Missing configuration',
      missing: configCheck.missing,
    });
    return;
  }

  try {
    const services = await runHealthChecks(origin);

    const errorCount = services.filter((s) => s.status === 'error').length;
    const overallStatus: HealthCheckResponse['status'] =
      errorCount === 0 ? 'healthy' : errorCount < services.length ? 'degraded' : 'unhealthy';

    const response: HealthCheckResponse = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services,
    };

    const statusCode = overallStatus === 'unhealthy' ? 503 : 200;

    logger.info('Health check complete', { status: overallStatus, errorCount });

    res.status(statusCode).json(response);
  } catch (err) {
    logger.error('Health check failed', { error: (err as Error).message });
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: (err as Error).message,
    });
  }
}
