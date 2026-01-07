-- Migration 004: Add rate_limits table for API rate limiting
-- Run this in your Supabase SQL Editor

-- ============================================================================
-- RATE_LIMITS TABLE
-- Tracks API requests per IP for rate limiting
-- ============================================================================

CREATE TABLE IF NOT EXISTS rate_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ip_address TEXT NOT NULL,
  endpoint TEXT NOT NULL DEFAULT 'valuation',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient rate limit queries
CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_endpoint_time 
  ON rate_limits(ip_address, endpoint, created_at DESC);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_rate_limits_created_at 
  ON rate_limits(created_at);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Only service role can access rate limits
CREATE POLICY "Service role full access to rate_limits" ON rate_limits
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- AUTOMATIC CLEANUP FUNCTION (Optional)
-- Runs daily to remove old rate limit records
-- ============================================================================

-- Create function to cleanup old records
CREATE OR REPLACE FUNCTION cleanup_rate_limits()
RETURNS void AS $$
BEGIN
  DELETE FROM rate_limits 
  WHERE created_at < NOW() - INTERVAL '2 hours';
END;
$$ LANGUAGE plpgsql;

-- Comment
COMMENT ON TABLE rate_limits IS 'Tracks API requests per IP for rate limiting (10 requests/hour/IP)';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT 'rate_limits table created successfully' as status;

