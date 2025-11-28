import type { VercelRequest } from '@vercel/node';

/**
 * Extract the origin URL from an incoming request
 * This is used to satisfy URL whitelist requirements for external APIs
 * 
 * Works automatically with any host/port - just needs to be registered in the whitelist
 */
export function getRequestOrigin(req: VercelRequest): string {
  // Check for forwarded protocol (when behind proxy/load balancer)
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = Array.isArray(forwardedProto) 
    ? forwardedProto[0] 
    : forwardedProto || 'http';

  // Get host from headers
  const host = req.headers.host || 'localhost:3000';

  return `${protocol}://${host}`;
}

