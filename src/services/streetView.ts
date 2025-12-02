import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { httpRequest } from '../utils/httpClient';
import type { StreetViewMetadata, StreetViewResult, HealthCheckResult } from '../types/services';

const BASE_URL = config.urls.streetView;

interface StreetViewOptions {
  width?: number;
  height?: number;
  fov?: number;
  heading?: number;
  pitch?: number;
}

/**
 * Build a Google Street View Static API URL
 */
export function buildStreetViewUrl(
  latitude: number,
  longitude: number,
  options: StreetViewOptions = {}
): string {
  const { width = 600, height = 400, fov = 90, heading = 0, pitch = 0 } = options;

  const params = new URLSearchParams({
    size: `${width}x${height}`,
    location: `${latitude},${longitude}`,
    fov: fov.toString(),
    heading: heading.toString(),
    pitch: pitch.toString(),
    key: config.googleMapsApiKey,
  });

  return `${BASE_URL}?${params.toString()}`;
}

/**
 * Check if Street View imagery is available at a location and return the URL
 */
export async function getStreetViewImage(
  latitude: number,
  longitude: number,
  options?: StreetViewOptions
): Promise<StreetViewResult> {
  logger.info('Getting Street View image', { latitude, longitude });

  // First check metadata to see if Street View is available
  const metadataUrl = `${BASE_URL}/metadata?location=${latitude},${longitude}&key=${config.googleMapsApiKey}`;

  const result = await httpRequest<StreetViewMetadata>(metadataUrl);

  if (!result.success) {
    logger.warn('Street View metadata check failed', { error: result.error });
    // Still return URL, it might work
    return {
      url: buildStreetViewUrl(latitude, longitude, options),
      available: false,
    };
  }

  const available = result.response.data.status === 'OK';
  const url = buildStreetViewUrl(latitude, longitude, options);

  logger.info('Street View result', { available, status: result.response.data.status });

  return { url, available };
}

/**
 * Health check for Google Street View API
 * Verifies the metadata endpoint responds with a valid status
 */
export async function healthCheck(): Promise<HealthCheckResult> {
  const start = Date.now();

  // Test with known London coordinates (Big Ben area - always has Street View)
  const testLat = 51.5007;
  const testLng = -0.1246;

  const metadataUrl = `${BASE_URL}/metadata?location=${testLat},${testLng}&key=${config.googleMapsApiKey}`;

  logger.info('Street View health check', { latitude: testLat, longitude: testLng });

  const result = await httpRequest<StreetViewMetadata>(metadataUrl);
  const latencyMs = Date.now() - start;

  if (!result.success) {
    logger.error('Street View health check failed - HTTP error', { error: result.error.message });
    return { ok: false, latencyMs, error: result.error.message };
  }

  // For Big Ben coordinates, status must be 'OK' (imagery always available)
  // No shortcuts - we use a location that definitely has Street View
  const status = result.response.data.status;
  
  if (status !== 'OK') {
    logger.error('Street View health check failed - unexpected status', { status });
    return { ok: false, latencyMs, error: `Street View API returned: ${status}` };
  }

  logger.info('Street View health check passed', { status });
  return { ok: true, latencyMs };
}

