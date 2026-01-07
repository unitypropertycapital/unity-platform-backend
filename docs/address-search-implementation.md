# Address Search Implementation

## Overview

This implementation adds a new `/api/address/search` endpoint that accepts postcode-only input and returns a list of addresses with UPRNs for dropdown selection.

**Key Achievement:** Reduces Ideal Postcodes API calls to **1 per unique postcode** (cached indefinitely thereafter).

---

## What Was Built

### 1. Database Migration

**File:** `migrations/002_add_postcode_lookups_cache.sql`

- New table `postcode_lookups` for caching postcode searches
- Stores normalized postcode + full address array
- Indexed for fast lookups

**To Deploy:** Run this SQL in Supabase SQL Editor:

```sql
-- See migrations/002_add_postcode_lookups_cache.sql
```

### 2. New API Endpoint

**Endpoint:** `POST /api/address/search`

**Request:**
```json
{
  "postcode": "SW1A 2AA"
}
```

**Response:**
```json
{
  "postcode": "SW1A2AA",
  "addresses": [
    {
      "uprn": "100023336956",
      "line_1": "10 Downing Street",
      "line_2": null,
      "line_3": null,
      "town": "London",
      "county": "Greater London",
      "postcode": "SW1A 2AA",
      "display": "10 Downing Street, London"
    }
  ],
  "count": 1,
  "cached": false
}
```

### 3. Optimization to `/api/address/resolve`

**Before:**
- Always called Ideal Postcodes API (1 call per address)

**After:**
- Checks `postcode_lookups` cache first
- Only calls Ideal Postcodes if postcode not cached
- If `/api/address/search` was called first → **0 API calls**

---

## API Call Reduction

### Scenario 1: User Searches Then Resolves
```
1. POST /api/address/search { postcode: "SW1A2AA" }
   → Calls Ideal Postcodes (1 API call)
   → Caches result
   
2. User selects address from dropdown
   
3. POST /api/address/resolve { postcode: "SW1A2AA", houseNumber: "10" }
   → Uses cached postcode data (0 API calls)
   
TOTAL: 1 Ideal Postcodes API call
```

### Scenario 2: User Directly Resolves (Legacy Flow)
```
1. POST /api/address/resolve { postcode: "SW1A2AA", houseNumber: "10" }
   → Calls Ideal Postcodes (1 API call)
   → Caches postcode lookup
   → Caches resolved address
   
TOTAL: 1 Ideal Postcodes API call
(Same as before, but now also caches postcode for future searches)
```

### Scenario 3: Multiple Users, Same Postcode
```
User A: POST /api/address/search { postcode: "SW1A2AA" }
        → 1 API call, cached

User B: POST /api/address/search { postcode: "SW1A2AA" }
        → 0 API calls (cache hit)

User C: POST /api/address/resolve { postcode: "SW1A2AA", houseNumber: "15" }
        → 0 API calls (cache hit)

TOTAL: 1 Ideal Postcodes API call for all users
```

---

## Testing Instructions

### 1. Deploy Database Migration

```bash
# Copy contents of migrations/002_add_postcode_lookups_cache.sql
# Paste into Supabase SQL Editor
# Run the migration
```

### 2. Test New Search Endpoint

**First Call (Cache Miss):**
```bash
curl -X POST https://your-domain/api/address/search \
  -H "Content-Type: application/json" \
  -d '{"postcode": "SW1A 2AA"}'
```

Expected:
- `cached: false`
- Returns array of addresses
- Ideal Postcodes API called (1 lookup)

**Second Call (Cache Hit):**
```bash
curl -X POST https://your-domain/api/address/search \
  -H "Content-Type: application/json" \
  -d '{"postcode": "SW1A 2AA"}'
```

Expected:
- `cached: true`
- Returns same array instantly
- **0 Ideal Postcodes API calls**

### 3. Test Optimized Resolve Endpoint

**After search endpoint was called:**
```bash
curl -X POST https://your-domain/api/address/resolve \
  -H "Content-Type: application/json" \
  -d '{
    "postcode": "SW1A 2AA",
    "houseNumber": "10"
  }'
```

Expected:
- Returns resolved address
- **0 Ideal Postcodes API calls** (uses cached postcode data)

### 4. Check Logs

Look for these log messages:

**Cache Hit:**
```
"Found cached postcode lookup" { postcode: "SW1A2AA", addressCount: X }
"Using cached postcode lookup (0 Ideal Postcodes calls)"
```

**Cache Miss:**
```
"Postcode not in cache, calling Ideal Postcodes API"
"Looking up postcode via Ideal Postcodes"
"Postcode lookup cached for future use"
```

---

## Billing Confirmation

According to Ideal Postcodes documentation:
- `/postcodes/{postcode}` returns **all addresses** for a postcode
- Billed as **1 lookup** per request (not per address returned)
- Maximum 100 addresses per postcode

This implementation caches that single lookup result indefinitely.

---

## Frontend Integration

### Recommended User Flow

1. **User enters postcode:**
   ```javascript
   const response = await fetch('/api/address/search', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ postcode: userPostcode })
   });
   
   const data = await response.json();
   // data.addresses = array of address options
   ```

2. **Show dropdown:**
   ```javascript
   data.addresses.forEach(addr => {
     // Display: addr.display
     // Value: addr.uprn or entire addr object
   });
   ```

3. **User selects address:**
   ```javascript
   // Option A: Use selected address directly (no resolve call)
   const selectedAddress = data.addresses[selectedIndex];
   
   // Option B: Call resolve if you need the cached address ID
   const resolved = await fetch('/api/address/resolve', {
     method: 'POST',
     body: JSON.stringify({
       postcode: selectedAddress.postcode,
       houseNumber: selectedAddress.line_1.split(' ')[0]
     })
   });
   ```

---

## Files Changed/Created

### New Files
- `migrations/002_add_postcode_lookups_cache.sql` - Database migration
- `api/address/search.ts` - New search endpoint
- `docs/address-search-implementation.md` - This file

### Modified Files
- `src/services/addressCache.ts` - Added postcode cache functions
- `src/types/request.ts` - Added search request/response types
- `api/address/resolve.ts` - Optimized to check postcode cache first

---

## Cache Strategy

- **Cache duration:** Indefinite (addresses rarely change)
- **Cache key:** Normalized postcode (uppercase, no spaces)
- **Cache invalidation:** Manual (future enhancement)
- **Race conditions:** Handled via upsert with `onConflict`

---

## Monitoring

### Key Metrics to Track

1. **Cache hit rate:**
   - Count of "Found cached postcode lookup" logs
   - Should increase over time as more postcodes are cached

2. **Ideal Postcodes API calls:**
   - Should see significant reduction
   - Only new postcodes trigger API calls

3. **Response times:**
   - Cached responses: ~50-100ms
   - API calls: ~200-500ms

---

## Next Steps

1. ✅ Deploy database migration
2. ✅ Deploy updated backend code
3. ✅ Test both endpoints with real postcodes
4. ✅ Update frontend to use new `/api/address/search` endpoint
5. ✅ Monitor cache hit rates and API usage

---

## Support

If you encounter any issues:
1. Check Supabase logs for database errors
2. Check Vercel logs for API endpoint errors
3. Verify migration was run successfully
4. Test with known valid UK postcode (e.g., "SW1A 2AA")


