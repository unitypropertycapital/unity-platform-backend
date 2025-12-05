import type { VercelRequest, VercelResponse } from '@vercel/node';
import { healthCheck as idealPostcodesHealth } from '../src/services/idealPostcodes';
import { healthCheck as propertyDataHealth } from '../src/services/propertyData';
import { healthCheck as epcHealth } from '../src/services/epc';
import { healthCheck as streetViewHealth } from '../src/services/streetView';
import { healthCheck as supabaseHealth } from '../src/services/supabase';
import { validateConfig } from '../src/utils/config';
import { logger } from '../src/utils/logger';
import { getRequestOrigin } from '../src/utils/requestOrigin';
import { handleError } from '../src/utils/errors';
import type { HealthCheckResponse, HealthCheckServicesMap, ServiceStatus } from '../src/types/services';

async function runHealthChecks(origin: string): Promise<HealthCheckServicesMap> {
  const [idealResult, propertyDataResult, epcResult, streetViewResult, supabaseResult] =
    await Promise.allSettled([
      idealPostcodesHealth(origin),
      propertyDataHealth(),
      epcHealth(),
      streetViewHealth(),
      supabaseHealth(),
    ]);

  const getStatus = (result: PromiseSettledResult<{ ok: boolean }>): ServiceStatus => {
    if (result.status === 'fulfilled' && result.value.ok) {
      return 'ok';
    }
    return 'error';
  };

    return {
    ideal_postcodes: getStatus(idealResult),
    property_data: getStatus(propertyDataResult),
    epc: getStatus(epcResult),
    google_street_view: getStatus(streetViewResult),
    supabase: getStatus(supabaseResult),
    };
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
      status: 'error',
      services: {
        ideal_postcodes: 'error',
        property_data: 'error',
        epc: 'error',
        google_street_view: 'error',
        supabase: 'error',
      },
    });
    return;
  }

  try {
    const services: HealthCheckServicesMap = await runHealthChecks(origin);

    const hasErrors = Object.values(services).some((s) => s === 'error');
    const overallStatus: 'ok' | 'error' = hasErrors ? 'error' : 'ok';

    const response: HealthCheckResponse = {
      status: overallStatus,
      services,
    };

    const statusCode = overallStatus === 'error' ? 503 : 200;

    logger.info('Health check complete', { status: overallStatus, services });

    res.status(statusCode).json(response);
  } catch (err) {
    // Centralized error handling - never silent
    handleError(err, { endpoint: '/api/health', origin });
    res.status(500).json({
      status: 'error',
      services: {
        ideal_postcodes: 'error',
        property_data: 'error',
        epc: 'error',
        google_street_view: 'error',
        supabase: 'error',
      },
    });
  }
}
