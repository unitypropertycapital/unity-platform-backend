# Operations Guide

Guide for operating and maintaining the Unity Property Valuation Backend.

---

## Table of Contents

1. [Environment Variables](#environment-variables)
2. [Key Rotation](#key-rotation)
3. [Viewing Logs in Supabase](#viewing-logs-in-supabase)
4. [Configuration Thresholds](#configuration-thresholds)
5. [Rate Limit Management](#rate-limit-management)
6. [Troubleshooting](#troubleshooting)

---

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `IDEAL_POSTCODES_API_KEY` | Ideal Postcodes API key | `ak_xxx` |
| `PROPERTY_DATA_API_KEY` | PropertyData.co.uk API key | `xxx` |
| `GOOGLE_STREET_VIEW_API_KEY` | Google Street View API key | `AIza...` |
| `SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase service role key | `eyJ...` |
| `HMAC_SECRET` | HMAC signing secret (shared with frontend) | `your-secret-key` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RATE_LIMIT_MAX` | Max requests per IP per window | `10` |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window in milliseconds | `3600000` (1 hour) |
| `LOG_LEVEL` | Logging verbosity | `info` |

### Setting Variables in Vercel

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add each variable for **Production**, **Preview**, and **Development**
4. Redeploy to apply changes

---

## Key Rotation

### Rotating HMAC Secret

1. **Generate new secret:**
   ```bash
   openssl rand -hex 32
   ```

2. **Update in Vercel:**
   - Go to Vercel → Settings → Environment Variables
   - Update `HMAC_SECRET` with new value

3. **Update frontend:**
   - Update the HMAC secret in your Webflow/frontend code
   - Deploy frontend changes

4. **Redeploy backend:**
   - Trigger a new deployment in Vercel

5. **Verify:**
   - Test a valuation request with the new signature
   - Old signatures will be rejected immediately

### Rotating API Keys

For each external API (Ideal Postcodes, PropertyData, Google):

1. Generate new key in the provider's dashboard
2. Update the environment variable in Vercel
3. Redeploy
4. Verify with `/api/health` endpoint
5. Revoke old key in provider's dashboard

### Rotating Supabase Keys

1. **Go to Supabase Dashboard:**
   - Project Settings → API

2. **Generate new service role key:**
   - Click "Generate new key" (if available)
   - Or create a new project and migrate

3. **Update environment variables:**
   - Update `SUPABASE_SERVICE_KEY` in Vercel

4. **Verify:**
   - Check `/api/health` shows `supabase: ok`

---

## Viewing Logs in Supabase

### Valuations Table

View all valuation requests and results:

```sql
-- Recent valuations (last 24 hours)
SELECT 
  created_at,
  input_address,
  postcode,
  property_type,
  status,
  market_value_central,
  conservative_value_mid,
  confidence_score,
  desk_review,
  desk_review_reason,
  processing_time_ms
FROM valuations
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

### Desk Review Cases

```sql
-- Desk review cases requiring attention
SELECT 
  created_at,
  input_address,
  postcode,
  desk_review_reason,
  comps_kept_count
FROM valuations
WHERE desk_review = TRUE
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

### Comparables for a Valuation

```sql
-- View comparables for a specific valuation
SELECT 
  address,
  sale_price,
  sale_date,
  distance_miles,
  floor_area_sqm,
  price_per_sqm,
  status,
  rejection_reason
FROM comps
WHERE valuation_id = 'YOUR-VALUATION-UUID'
ORDER BY status, distance_miles;
```

### Error Analysis

```sql
-- Valuations with errors
SELECT 
  created_at,
  input_address,
  postcode,
  error_message,
  request_origin
FROM valuations
WHERE status = 'error'
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

### Performance Metrics

```sql
-- Average processing time by day
SELECT 
  DATE(created_at) as date,
  COUNT(*) as total_requests,
  AVG(processing_time_ms) as avg_time_ms,
  MAX(processing_time_ms) as max_time_ms,
  SUM(CASE WHEN desk_review THEN 1 ELSE 0 END) as desk_reviews,
  SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
FROM valuations
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

---

## Configuration Thresholds

### Comparable Selection

These thresholds are configured in `src/engine/comparables/filter.ts`:

| Parameter | Current Value | Description |
|-----------|---------------|-------------|
| `maxRecencyMonths` | 24 | Max age of comparable sales |
| `sizeTolerance` | 0.5 | Size variance allowed (50%) |
| `outlierIqrMultiplier` | 1.5 | IQR multiplier for outlier detection |
| `minComps` | 3 | Minimum comps required |

### Radius Expansion

Configured in `src/engine/comparables/fetcher.ts`:

```javascript
const RADIUS_STEPS = [0.25, 0.5, 0.75, 1.0]; // miles
```

### Confidence Scoring

Configured in `src/engine/valuation/confidence.ts`:

| Factor | Weight | Description |
|--------|--------|-------------|
| Comp count | 30% | Number of comparables |
| CV (variance) | 25% | Price consistency |
| Recency | 25% | How recent the sales are |
| Floor area quality | 20% | Data completeness |

### Offer Percentages

Configured in `src/engine/valuation/offers.ts`:

| Offer Type | Percentage of Conservative Value |
|------------|----------------------------------|
| Fast Track | 80% |
| Flexible | 90% |

### Changing Thresholds

1. Edit the relevant configuration file
2. Run tests: `npm run test`
3. Run calibration: `npx ts-node scripts/run-calibration-tests.ts`
4. Commit and deploy

---

## Rate Limit Management

### Current Limits

- **Default:** 10 requests per IP per hour
- **Configurable via:** `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS`

### Viewing Rate Limit Data

```sql
-- Current rate limit status by IP
SELECT 
  ip_address,
  endpoint,
  COUNT(*) as request_count,
  MIN(created_at) as first_request,
  MAX(created_at) as last_request
FROM rate_limits
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY ip_address, endpoint
ORDER BY request_count DESC;
```

### Clearing Rate Limits for an IP

```sql
-- Clear rate limit for specific IP
DELETE FROM rate_limits 
WHERE ip_address = '123.45.67.89';
```

### Cleanup Old Records

```sql
-- Manual cleanup of old rate limit records
DELETE FROM rate_limits 
WHERE created_at < NOW() - INTERVAL '2 hours';
```

### Adjusting Rate Limits

1. **Increase limit:**
   ```
   RATE_LIMIT_MAX=20
   ```

2. **Change window:**
   ```
   RATE_LIMIT_WINDOW_MS=1800000  # 30 minutes
   ```

3. **Disable rate limiting:**
   ```
   RATE_LIMIT_MAX=0
   ```

---

## Troubleshooting

### Health Check Failing

**Symptom:** `/api/health` returns errors for services

**Solutions:**

1. **ideal_postcodes: error**
   - Check API key is valid
   - Check account has credits
   - Visit https://account.ideal-postcodes.co.uk

2. **property_data: error**
   - Check API key is valid
   - May be rate limited (wait and retry)
   - Check https://propertydata.co.uk status

3. **supabase: error**
   - Verify `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`
   - Check Supabase project status
   - Ensure tables exist (run migrations)

### Valuations Returning Desk Review

**Common causes:**

1. **No comparable sales data**
   - Rural/unusual location
   - New postcode area
   - Limited transaction history

2. **Missing floor area**
   - No EPC on file
   - Property not registered

3. **Insufficient comps**
   - Try expanding search criteria
   - Consider manual valuation

### HMAC Verification Failing

**Checklist:**

1. Verify `HMAC_SECRET` matches frontend
2. Check field order in signature:
   - addressLine1, postcode, propertyType, saleTimeline, consent
3. Ensure values are exact (case-sensitive)
4. Check for encoding issues

### Rate Limit Issues

**Symptom:** Legitimate users getting 429 errors

**Solutions:**

1. Check `rate_limits` table for the IP
2. Clear records if needed
3. Increase `RATE_LIMIT_MAX` if appropriate
4. Check for proxy/CDN issues (multiple users same IP)

### Slow Response Times

**Diagnosis:**

```sql
-- Find slow valuations
SELECT 
  created_at,
  input_address,
  processing_time_ms,
  comps_kept_count
FROM valuations
WHERE processing_time_ms > 10000
ORDER BY processing_time_ms DESC
LIMIT 20;
```

**Common causes:**

1. External API latency (PropertyData, EPC)
2. Large number of comparables to process
3. Database connection issues

---

## Monitoring Recommendations

### Key Metrics to Track

1. **Request volume** - Daily/hourly valuation requests
2. **Desk review rate** - % of valuations requiring review
3. **Error rate** - % of failed valuations
4. **Response time** - Average processing time
5. **API credit usage** - External API consumption

### Alerts to Set Up

1. Error rate > 5%
2. Average response time > 15 seconds
3. Desk review rate > 50%
4. External API health check failures

### Log Retention

Recommended retention periods:

| Table | Retention |
|-------|-----------|
| `valuations` | 2 years |
| `comps` | 2 years |
| `rate_limits` | 2 hours |
| `addresses` | Indefinite (cache) |
| `postcode_lookups` | Indefinite (cache) |

