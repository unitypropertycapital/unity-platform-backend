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
 */
export async function healthCheck(): Promise<HealthCheckResult> {
  const start = Date.now();

  // Test with known London coordinates (Big Ben area)
  const testLat = 51.5007;
  const testLng = -0.1246;

  try {
    const result = await getStreetViewImage(testLat, testLng);
    const latencyMs = Date.now() - start;

    if (result.available) {
      return { ok: true, latencyMs };
    }

    // API responded but no imagery - still counts as working
    return { ok: true, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return { ok: false, latencyMs, error: (err as Error).message };
  }
}

