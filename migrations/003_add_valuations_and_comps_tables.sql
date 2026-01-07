-- Migration 003: Add valuations and comps tables for logging
-- Run this in your Supabase SQL Editor
-- 
-- NOTE: This migration will DROP existing valuations/comps tables if they exist
-- Remove the DROP statements if you want to preserve existing data

-- ============================================================================
-- DROP EXISTING TABLES (if any) - Remove these lines to preserve data
-- ============================================================================

DROP TABLE IF EXISTS comps CASCADE;
DROP TABLE IF EXISTS valuations CASCADE;

-- ============================================================================
-- VALUATIONS TABLE
-- Stores every valuation request and its results
-- ============================================================================

CREATE TABLE valuations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Request input
  input_address TEXT NOT NULL,           -- addressLine1 from request
  input_address_2 TEXT,                  -- addressLine2 from request (optional)
  postcode TEXT NOT NULL,
  property_type TEXT NOT NULL,           -- house, flat, bungalow
  sale_timeline TEXT NOT NULL,           -- 0-8_weeks, 8-16_weeks, 16+_weeks
  reason_for_selling TEXT,
  source TEXT,                           -- website, api, etc.
  
  -- Resolved address info
  address_id UUID REFERENCES addresses(id),  -- FK to cached address
  uprn TEXT,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  normalized_address TEXT,
  
  -- EPC data
  epc_available BOOLEAN DEFAULT FALSE,
  floor_area_sqm DECIMAL(10, 2),
  floor_area_sqft DECIMAL(10, 2),
  habitable_rooms INTEGER,
  epc_rating TEXT,                       -- A, B, C, D, E, F, G
  epc_score INTEGER,
  
  -- Market value results
  market_value_low INTEGER,
  market_value_central INTEGER,
  market_value_high INTEGER,
  
  -- Conservative value results
  conservative_value_low INTEGER,
  conservative_value_mid INTEGER,
  conservative_value_high INTEGER,
  
  -- Offers
  fast_track_offer INTEGER,
  flexible_offer INTEGER,
  selected_offer_type TEXT,              -- fast_track or flexible
  
  -- Confidence
  confidence_score INTEGER,
  confidence_label TEXT,                 -- excellent, good, fair, low
  
  -- Comparables metadata
  search_radius_miles DECIMAL(4, 2),
  comps_kept_count INTEGER DEFAULT 0,
  comps_rejected_count INTEGER DEFAULT 0,
  
  -- Desk review
  desk_review BOOLEAN DEFAULT FALSE,
  desk_review_reason TEXT,
  
  -- Diagnostics (stored as JSON for flexibility)
  diagnostics JSONB,
  conservative_diagnostics JSONB,
  
  -- Ex-LA detection
  is_ex_local_authority BOOLEAN DEFAULT FALSE,
  ex_la_score INTEGER,
  
  -- Street view
  street_view_url TEXT,
  street_view_available BOOLEAN DEFAULT FALSE,
  
  -- Request metadata
  request_origin TEXT,                   -- Origin header
  request_ip TEXT,                       -- Client IP for rate limiting reference
  hmac_valid BOOLEAN DEFAULT FALSE,      -- Whether HMAC was verified
  
  -- Processing time
  processing_time_ms INTEGER,            -- How long the valuation took
  
  -- Status
  status TEXT DEFAULT 'success',         -- success, desk_review, error
  error_message TEXT,                    -- If status is error
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_valuations_postcode ON valuations(postcode);
CREATE INDEX idx_valuations_uprn ON valuations(uprn);
CREATE INDEX idx_valuations_created_at ON valuations(created_at DESC);
CREATE INDEX idx_valuations_status ON valuations(status);
CREATE INDEX idx_valuations_desk_review ON valuations(desk_review) WHERE desk_review = TRUE;
CREATE INDEX idx_valuations_address_id ON valuations(address_id);

-- ============================================================================
-- COMPS TABLE
-- Stores comparables used (and rejected) for each valuation
-- ============================================================================

CREATE TABLE comps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  valuation_id UUID NOT NULL REFERENCES valuations(id) ON DELETE CASCADE,
  
  -- Comparable property info
  address TEXT NOT NULL,
  postcode TEXT,
  uprn TEXT,
  
  -- Sale info
  sale_price INTEGER NOT NULL,
  sale_date DATE,
  months_ago INTEGER,                    -- How many months ago the sale was
  
  -- Property details
  property_type TEXT,
  floor_area_sqm DECIMAL(10, 2),
  price_per_sqm DECIMAL(10, 2),
  
  -- Location
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  distance_miles DECIMAL(6, 3),
  
  -- Weighting (for kept comps)
  weight DECIMAL(5, 4),                  -- Weight used in valuation calculation
  
  -- Status
  status TEXT NOT NULL DEFAULT 'kept',   -- kept, rejected
  rejection_reason TEXT,                 -- Why it was rejected (if rejected)
  rejection_category TEXT,               -- Category of rejection (size, age, distance, etc.)
  
  -- EPC data for comparable
  epc_rating TEXT,
  habitable_rooms INTEGER,
  
  -- Ex-LA detection for comparable
  is_ex_local_authority BOOLEAN DEFAULT FALSE,
  ex_la_score INTEGER,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_comps_valuation_id ON comps(valuation_id);
CREATE INDEX idx_comps_status ON comps(status);
CREATE INDEX idx_comps_postcode ON comps(postcode);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on both tables
ALTER TABLE valuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE comps ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything
CREATE POLICY "Service role full access to valuations" ON valuations
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access to comps" ON comps
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Policy: Authenticated users can read (for dashboard access if needed)
CREATE POLICY "Authenticated users can read valuations" ON valuations
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read comps" ON comps
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- ============================================================================
-- HELPER FUNCTION: Update timestamp on modification
-- ============================================================================

-- Drop existing trigger and function if they exist
DROP TRIGGER IF EXISTS valuations_updated_at_trigger ON valuations;
DROP FUNCTION IF EXISTS update_valuations_updated_at();

CREATE OR REPLACE FUNCTION update_valuations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER valuations_updated_at_trigger
  BEFORE UPDATE ON valuations
  FOR EACH ROW
  EXECUTE FUNCTION update_valuations_updated_at();

-- ============================================================================
-- COMMENTS (for documentation in Supabase UI)
-- ============================================================================

COMMENT ON TABLE valuations IS 'Stores all valuation requests and results for logging and analytics';
COMMENT ON TABLE comps IS 'Stores comparable properties used in each valuation (kept and rejected)';

COMMENT ON COLUMN valuations.status IS 'success = full valuation, desk_review = needs manual review, error = failed';
COMMENT ON COLUMN valuations.desk_review_reason IS 'Human-readable reason why desk review is required';
COMMENT ON COLUMN valuations.diagnostics IS 'Full diagnostics JSON from valuation engine';

COMMENT ON COLUMN comps.status IS 'kept = used in valuation, rejected = excluded';
COMMENT ON COLUMN comps.weight IS 'Weight assigned to this comp in the valuation calculation (0-1)';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Verify tables were created
SELECT 'valuations' as table_name, count(*) as row_count FROM valuations
UNION ALL
SELECT 'comps' as table_name, count(*) as row_count FROM comps;
