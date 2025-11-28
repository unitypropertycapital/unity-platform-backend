-- Moov Valuation API - Supabase Database Schema
-- Run this in the Supabase SQL Editor
 vc
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Valuations table - stores each valuation request and result
CREATE TABLE IF NOT EXISTS valuations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Input address
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  postcode TEXT NOT NULL,
  normalized_address TEXT,
  
  -- Resolved property data
  uprn TEXT,
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  floor_area_sqm NUMERIC(8, 2),
  property_type TEXT NOT NULL,
  epc_rating TEXT,
  
  -- Market value results
  mv_low NUMERIC(12, 2),
  mv_high NUMERIC(12, 2),
  mv_central NUMERIC(12, 2),
  
  -- Fast-Track offer range
  fast_low NUMERIC(12, 2),
  fast_high NUMERIC(12, 2),
  
  -- Flexible offer range
  flex_low NUMERIC(12, 2),
  flex_high NUMERIC(12, 2),
  
  -- Selected offer
  selected_offer TEXT,
  
  -- Confidence scoring
  confidence_score INTEGER,
  confidence_label TEXT,
  
  -- Valuation metadata
  radius_used NUMERIC(4, 2),
  comps_count INTEGER,
  
  -- Desk review
  desk_review BOOLEAN DEFAULT FALSE,
  desk_review_reason TEXT,
  
  -- Request context
  sale_timeline TEXT,
  reason_for_selling TEXT,
  source TEXT,
  
  -- Street View
  street_view_url TEXT,
  street_view_available BOOLEAN,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Comps table - stores comparable properties used/rejected in valuation
CREATE TABLE IF NOT EXISTS comps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  valuation_id UUID REFERENCES valuations(id) ON DELETE CASCADE,
  
  -- Source and identification
  source TEXT NOT NULL, -- 'LR' (Land Registry) or 'PD' (PropertyData)
  
  -- Property data
  address TEXT,
  postcode TEXT,
  sale_price NUMERIC(12, 2),
  sale_date DATE,
  property_type TEXT,
  
  -- Size and price per sqm
  floor_area_sqm NUMERIC(8, 2),
  psqm NUMERIC(10, 2),
  
  -- Distance and weighting
  distance_miles NUMERIC(6, 3),
  weight NUMERIC(5, 4),
  
  -- Whether comp was used in valuation
  used BOOLEAN DEFAULT TRUE,
  rejection_reason TEXT,
  
  -- Coordinates
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_valuations_postcode ON valuations(postcode);
CREATE INDEX IF NOT EXISTS idx_valuations_uprn ON valuations(uprn);
CREATE INDEX IF NOT EXISTS idx_valuations_created_at ON valuations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_valuations_desk_review ON valuations(desk_review);

CREATE INDEX IF NOT EXISTS idx_comps_valuation_id ON comps(valuation_id);
CREATE INDEX IF NOT EXISTS idx_comps_used ON comps(used);

-- Updated timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_valuations_updated_at
  BEFORE UPDATE ON valuations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS)
-- For production, enable RLS and create appropriate policies
ALTER TABLE valuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE comps ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (for the API)
CREATE POLICY "Service role full access to valuations"
  ON valuations
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access to comps"
  ON comps
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Grant permissions
GRANT ALL ON valuations TO service_role;
GRANT ALL ON comps TO service_role;

-- Comments
COMMENT ON TABLE valuations IS 'Stores all property valuation requests and results';
COMMENT ON TABLE comps IS 'Stores comparable properties used in each valuation';

