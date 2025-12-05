export const config = {
  // API Keys (from environment)
  idealPostcodesApiKey: process.env.IDEAL_POSTCODES_API_KEY || '',
  propertyDataApiKey: process.env.PROPERTYDATA_API_KEY || '',
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || '',
  hmacSecret: process.env.HMAC_SECRET || '',

  // HTTP settings
  http: {
    timeout: 1500, // 1.5 seconds
    retries: 2,
  },

  // API base URLs
  urls: {
    idealPostcodes: 'https://api.ideal-postcodes.co.uk/v1',
    propertyData: 'https://api.propertydata.co.uk',
    streetView: 'https://maps.googleapis.com/maps/api/streetview',
  },

  // Comparable search settings
  comparables: {
    // Radius expansion steps in miles
    radiusSteps: [0.25, 0.5, 0.75, 1.0] as readonly number[],
    
    // Minimum number of valid comps required (below this triggers deskReview)
    minComps: 3,
    
    // Maximum age of sales in months (primary filter)
    maxRecencyMonths: 24,
    
    // Fallback recency if not enough comps found
    fallbackRecencyMonths: 36,
    
    // Size tolerance: ±20% of subject floor area
    sizeTolerance: 0.20,
    
    // IQR multiplier for outlier detection (1.5 = standard, 3.0 = extreme only)
    outlierIqrMultiplier: 1.5,
    
    // Maximum age for sold prices API query (in months)
    maxAgeMonths: 36,
  },
} as const;

/**
 * Automatically detect the origin URL from runtime environment
 * Used for Ideal Postcodes URL whitelist verification
 * No manual configuration required - detects from Vercel or local runtime
 */
export function getAutoOrigin(): string {
  // Vercel deployments (VERCEL_URL is auto-set by Vercel, not by user)
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  // Local development - use PORT if set, otherwise default 3000
  const port = process.env.PORT || '3000';
  return `http://localhost:${port}`;
}

export function validateConfig(): { valid: boolean; missing: string[] } {
  const required = [
    'idealPostcodesApiKey',
    'propertyDataApiKey',
    'googleMapsApiKey',
    'supabaseUrl',
    'supabaseServiceKey',
  ] as const;

  const missing = required.filter((key) => !config[key]);

  return {
    valid: missing.length === 0,
    missing,
  };
}

