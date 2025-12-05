/**
 * Distance Calculation Utilities
 * Haversine formula for calculating distance between two coordinates
 */

// Earth's radius in miles
const EARTH_RADIUS_MILES = 3958.8;

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * 
 * @param lat1 - Latitude of first point
 * @param lon1 - Longitude of first point
 * @param lat2 - Latitude of second point
 * @param lon2 - Longitude of second point
 * @returns Distance in miles
 */
export function calculateDistanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distance = EARTH_RADIUS_MILES * c;

  // Round to 3 decimal places
  return Math.round(distance * 1000) / 1000;
}

/**
 * Check if a point is within a given radius of another point
 * 
 * @param subjectLat - Subject property latitude
 * @param subjectLon - Subject property longitude
 * @param compLat - Comparable property latitude
 * @param compLon - Comparable property longitude
 * @param radiusMiles - Maximum radius in miles
 * @returns True if within radius
 */
export function isWithinRadius(
  subjectLat: number,
  subjectLon: number,
  compLat: number,
  compLon: number,
  radiusMiles: number
): boolean {
  const distance = calculateDistanceMiles(subjectLat, subjectLon, compLat, compLon);
  return distance <= radiusMiles;
}


