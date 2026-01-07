export const config = {
  // API Keys (from environment)
  idealPostcodesApiKey: process.env.IDEAL_POSTCODES_API_KEY || '',
  propertyDataApiKey: process.env.PROPERTYDATA_API_KEY || '',
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || '',
  hmacSecret: process.env.HMAC_SECRET || '',
  
  // UK Government EPC API (requires free registration)
  // Register at: https://epc.opendatacommunities.org/
  govEpcApiKey: process.env.GOV_EPC_API_KEY || '',
  govEpcEmail: process.env.GOV_EPC_EMAIL || '',

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

  // Valuation engine settings
  valuation: {
    // Market value band percentages
    bandPercentNormal: 0.08,  // ±8% for normal confidence
    bandPercentWide: 0.10,    // ±10% for lower confidence
    
    // Offer percentages (of central market value)
    fastTrackLow: 0.75,       // Fast-Track offer minimum (75%)
    fastTrackHigh: 0.85,      // Fast-Track offer maximum (85%)
    flexibleLow: 0.85,        // Flexible offer minimum (85%)
    flexibleHigh: 0.92,       // Flexible offer maximum (92%)
    
    // Desk review thresholds
    minCompsForValuation: 3,  // Minimum comps required for valuation
    varianceThreshold: 0.50,  // CV > 50% triggers desk review
    maxCoefficientOfVariation: 0.50,  // Same as varianceThreshold
    staleDataMonths: 20,      // Average comp age > 20 months triggers desk review
    maxAverageAgeMonths: 20,  // Same as staleDataMonths
    
    // Confidence score thresholds
    confidenceHighThreshold: 70,   // Score >= 70 = HIGH
    confidenceMediumThreshold: 40, // Score >= 40 = MEDIUM, < 40 = LOW
  },

  // Conservative valuation settings
  conservative: {
    // Size tolerance for comps (relaxed to allow cheaper comps)
    flatSizeTolerance: 0.35,      // ±35% for flats
    houseSizeTolerance: 0.30,     // ±30% for houses
    
    // Outlier detection (relaxed to keep cheap comps)
    outlierIqrMultiplier: 2.0,    // Was 1.5, now 2.0 to allow more variance
    
    // Recency fallback settings
    fallbackRecencyMonths: 36,    // Allow 36 months if <4 comps
    fallbackMinComps: 4,          // Trigger fallback if fewer than this
    fallbackMaxRadius: 0.5,       // Only use fallback within this radius
    
    // Conservative offer percentages (of conservative central value)
    fastTrackLow: 0.75,           // Fast-Track minimum (75%)
    fastTrackHigh: 0.82,          // Fast-Track maximum (82%)
    flexibleLow: 0.82,            // Flexible minimum (82%)
    flexibleHigh: 0.88,           // Flexible maximum (88%)
    
    // Conservative value band
    bandPercent: 0.05,            // ±5% for conservative band
    
    // Penalty thresholds
    towerFloorThreshold: 10,      // >=10 floors = tower block
    claddingFloorThreshold: 6,    // >=6 floors = apply cladding penalty if unknown
    exLAFloorThreshold: 7,        // >=7 floors = signal for ex-LA detection
    
    // Block penalties (flats only) - REDUCED after market segmentation implementation
    // Market segmentation now provides correct baseline, so penalties can be lighter
    towerPenalty: 0.03,           // 3% for tower blocks (>=10 floors) - reduced from 8%
    exLAPenalty: 0.05,            // 5% for ex-local authority - reduced from 12%
    eraPenalty: 0.02,             // 2% for 1960-1983 construction - reduced from 5%
    claddingPenalty: 0.02,        // 2% for unknown cladding on tall buildings - reduced from 5%
    maxBlockPenalty: 0.12,        // Cap total block penalty at 12% - reduced from 28%
    
    // Small unit penalties (flats only) - FURTHER REDUCED for fine-tuning
    verySmallUnitThreshold: 50,   // <50 sqm = very small
    smallUnitThreshold: 60,       // 50-60 sqm = small
    verySmallUnitPenalty: 0.03,   // 3% for <50 sqm - reduced from 6%
    smallUnitPenalty: 0.01,       // 1% for 50-60 sqm - reduced from 3%
    
    // Confidence penalties - FURTHER REDUCED for fine-tuning (halved for segment-matched comps)
    highConfidencePenalty: 0.005, // 0.5% for confidence >=80 - reduced from 1%
    mediumConfidencePenalty: 0.015, // 1.5% for confidence 70-79 - reduced from 3%
    lowConfidencePenalty: 0.025,  // 2.5% for confidence 60-69 - reduced from 5%
    veryLowConfidencePenalty: 0.035, // 3.5% for confidence <60 - reduced from 7%
    
    // CV (price dispersion) penalties - HALVED for fine-tuning
    highCVThreshold: 0.25,        // CV >=25% = high dispersion
    mediumCVThreshold: 0.18,      // CV 18-25% = medium dispersion
    highCVPenalty: 0.025,         // 2.5% for high CV - reduced from 5%
    mediumCVPenalty: 0.015,       // 1.5% for medium CV - reduced from 3%
    
    // Ex-LA detection thresholds
    exLAScoreThreshold: 4,        // Score >=4 = classify as ex-LA (was 3, raised to 4 to prevent false positives like Princess Court)
    cheapCompThreshold: 0.70,     // Comps <70% of postcode median = cheap pattern
    minCheapCompsForPattern: 3,   // Need at least 3 cheap comps for pattern
    
    // New-build filtering for ex-LA valuations
    newBuildMaxAgeMonths: 24,     // Comps within 24 months may be new builds
    newBuildPriceThreshold: 1.30, // Comps >130% of median may be new builds
  },

  // Tiered API call settings (to minimize PropertyData calls)
  apiTiers: {
    // Tier 1: Subject postcode only (1-2 calls)
    tier1MinComps: 4,             // Need at least 4 comps with floor area to stay in Tier 1
    tier1MinConfidence: 60,       // Minimum confidence to stay in Tier 1
    
    // Tier 2: Escalation (up to 4-5 calls total)
    tier2MaxPostcodes: 3,         // Max additional postcodes to fetch in Tier 2
    tier2MinComps: 3,             // Minimum comps needed to avoid desk review
    
    // Hard cap on API calls
    maxFloorAreaCalls: 4,         // Maximum /floor-areas calls per valuation
    
    // Rate limiting between calls
    delayBetweenCallsMs: 200,     // 200ms delay between PropertyData calls
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
