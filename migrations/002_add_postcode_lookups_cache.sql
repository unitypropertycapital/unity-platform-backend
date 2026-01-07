-- Migration: Add postcode lookups cache table
-- Purpose: Cache postcode-level address searches from Ideal Postcodes API
-- This reduces API calls when multiple users search the same postcode
-- or when a user searches then resolves an address

-- Create postcode_lookups table
CREATE TABLE IF NOT EXISTS postcode_lookups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  postcode TEXT NOT NULL UNIQUE,  -- normalized postcode (no spaces, uppercase e.g. "SW1A2AA")
  addresses JSONB NOT NULL,        -- array of address objects from Ideal Postcodes
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast postcode lookups
CREATE INDEX IF NOT EXISTS idx_postcode_lookups_postcode ON postcode_lookups(postcode);

-- Index for cleanup queries (if we want to expire old cache entries later)
CREATE INDEX IF NOT EXISTS idx_postcode_lookups_created_at ON postcode_lookups(created_at);

-- Add comment for documentation
COMMENT ON TABLE postcode_lookups IS 'Caches full address lists by postcode from Ideal Postcodes API to minimize API calls';
COMMENT ON COLUMN postcode_lookups.postcode IS 'Normalized postcode without spaces in uppercase (e.g. SW1A2AA)';
COMMENT ON COLUMN postcode_lookups.addresses IS 'Array of address objects returned from Ideal Postcodes API';


