# API Reference

Complete API documentation for the Unity Property Valuation Backend.

## Base URL

- **Production:** `https://your-domain.vercel.app`
- **Local Development:** `http://localhost:3000`

---

## Authentication

### HMAC Signature

All valuation requests must include an HMAC signature for authentication.

**Signature Generation:**

```javascript
const crypto = require('crypto');

// Fields used for signature (in order)
const fieldsToSign = [
  payload.addressLine1,
  payload.postcode,
  payload.propertyType,
  payload.saleTimeline,
  payload.consent
].join('|');

const hmac = crypto
  .createHmac('sha256', HMAC_SECRET)
  .update(fieldsToSign)
  .digest('hex');
```

**Example:**
```
addressLine1: "10 Downing Street"
postcode: "SW1A 2AA"
propertyType: "house"
saleTimeline: "8-16_weeks"
consent: true

String to sign: "10 Downing Street|SW1A 2AA|house|8-16_weeks|true"
```

---

## Rate Limiting

- **Limit:** 10 requests per IP per hour
- **Headers returned:**
  - `X-RateLimit-Remaining`: Requests remaining in window
  - `X-RateLimit-Reset`: ISO timestamp when limit resets
  - `Retry-After`: Seconds until rate limit resets (on 429 only)

---

## Endpoints

### 1. Health Check

Check API and service status.

**Request:**
```
GET /api/health
```

**Response (200 OK):**
```json
{
  "status": "ok",
  "services": {
    "ideal_postcodes": "ok",
    "property_data": "ok",
    "epc": "ok",
    "google_street_view": "ok",
    "supabase": "ok"
  }
}
```

---

### 2. Address Search

Search for addresses by postcode. Returns a list for dropdown selection.

**Request:**
```
POST /api/address/search
Content-Type: application/json

{
  "postcode": "SW1A 2AA"
}
```

**Request Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `postcode` | string | Yes | UK postcode (spaces optional) |

**Response (200 OK):**
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
      "country": "England",
      "postcode": "SW1A 2AA",
      "display": "10 Downing Street, London"
    }
  ],
  "count": 1,
  "cached": false
}
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `postcode` | string | Normalized postcode (no spaces, uppercase) |
| `addresses` | array | List of address options |
| `addresses[].uprn` | string | Unique Property Reference Number |
| `addresses[].line_1` | string | Primary address line |
| `addresses[].line_2` | string | Secondary address line (often building name) |
| `addresses[].line_3` | string | Tertiary address line |
| `addresses[].town` | string | Town/city |
| `addresses[].country` | string | Country |
| `addresses[].postcode` | string | Formatted postcode |
| `addresses[].display` | string | Formatted display string for dropdowns |
| `count` | number | Number of addresses found |
| `cached` | boolean | Whether result came from cache |

---

### 3. Address Resolve

Resolve a specific address by postcode + house number. Returns cached address with UUID.

**Request:**
```
POST /api/address/resolve
Content-Type: application/json

{
  "postcode": "SW1A 2AA",
  "houseNumber": "10"
}
```

**Request Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `postcode` | string | Yes | UK postcode |
| `houseNumber` | string | Yes | House number or name |

**Response (200 OK):**
```json
{
  "id": "e294d7b8-992b-4908-acfc-e7854dbac5a7",
  "postcode": "SW1A 2AA",
  "house_number": "10",
  "address_line_1": "10 Downing Street",
  "address_line_2": null,
  "town": "London",
  "county": "Greater London",
  "country": "England",
  "uprn": "100023336956",
  "udprn": "12345678",
  "latitude": 51.5034,
  "longitude": -0.1276,
  "created_at": "2026-01-07T10:30:00.000Z",
  "updated_at": "2026-01-07T10:30:00.000Z"
}
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | **Use this as `addressId` in valuation request** |
| `postcode` | string | Resolved postcode |
| `house_number` | string | House number/name |
| `address_line_1` | string | Primary address line |
| `address_line_2` | string | Secondary address line |
| `town` | string | Town/city |
| `county` | string | County |
| `country` | string | Country |
| `uprn` | string | Unique Property Reference Number |
| `udprn` | string | Unique Delivery Point Reference Number |
| `latitude` | number | Latitude coordinate |
| `longitude` | number | Longitude coordinate |
| `created_at` | string | ISO timestamp |
| `updated_at` | string | ISO timestamp |

---

### 4. Valuation

Get property valuation with market value, offers, and confidence scoring.

**Request:**
```
POST /api/valuation
Content-Type: application/json

{
  "addressId": "e294d7b8-992b-4908-acfc-e7854dbac5a7",
  "addressLine1": "10 Downing Street",
  "postcode": "SW1A 2AA",
  "propertyType": "house",
  "saleTimeline": "8-16_weeks",
  "reasonForSelling": "Relocating",
  "source": "website",
  "consent": true,
  "hmac": "a1b2c3d4e5f6..."
}
```

**Request Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `addressId` | string (UUID) | Recommended | UUID from `/api/address/resolve` (eliminates extra API calls) |
| `addressLine1` | string | Yes | First line of address |
| `addressLine2` | string | No | Second line of address |
| `postcode` | string | Yes | UK postcode |
| `propertyType` | string | Yes | One of: `house`, `flat`, `bungalow` |
| `saleTimeline` | string | Yes | One of: `0-8_weeks`, `8-16_weeks`, `16+_weeks` |
| `reasonForSelling` | string | Yes | Reason for sale |
| `source` | string | Yes | Request source identifier |
| `consent` | boolean | Yes | User consent flag |
| `hmac` | string | Yes | HMAC signature (64-char hex) |

**Response (200 OK - Success):**
```json
{
  "subjectProperty": {
    "line_1": "10 Downing Street",
    "line_2": "",
    "line_3": "",
    "post_town": "London",
    "postcode": "SW1A 2AA",
    "normalizedAddress": "10 Downing Street, London SW1A 2AA",
    "uprn": "100023336956",
    "coordinates": {
      "latitude": 51.5034,
      "longitude": -0.1276
    }
  },
  "epc": {
    "available": true,
    "floorAreaSqm": 150,
    "floorAreaSqFt": 1615,
    "habitableRooms": 6,
    "rating": "C",
    "score": 72
  },
  "streetViewUrl": "https://maps.googleapis.com/...",
  "streetViewAvailable": true,
  "marketValue": {
    "low": 1800000,
    "central": 2000000,
    "high": 2200000
  },
  "conservativeMarketValue": {
    "low": 1700000,
    "central": 1900000,
    "high": 2100000
  },
  "offers": {
    "fastTrack": 1520000,
    "flexible": 1710000,
    "selectedOfferType": "flexible"
  },
  "confidence": {
    "score": 75,
    "label": "good"
  },
  "deskReview": false,
  "deskReviewReason": null,
  "diagnostics": { ... },
  "conservativeDiagnostics": { ... },
  "comparables": {
    "kept": [ ... ],
    "rejected": [ ... ],
    "metadata": { ... }
  },
  "timestamp": "2026-01-07T10:30:00.000Z"
}
```

**Response (200 OK - Desk Review Required):**
```json
{
  "subjectProperty": { ... },
  "epc": { ... },
  "streetViewUrl": "...",
  "streetViewAvailable": true,
  "marketValue": null,
  "conservativeMarketValue": null,
  "offers": null,
  "confidence": null,
  "deskReview": true,
  "deskReviewReason": "Only 2 valid comparable(s) found within 1 mile radius (minimum 3 required)",
  "diagnostics": { ... },
  "comparables": { ... },
  "timestamp": "2026-01-07T10:30:00.000Z"
}
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `subjectProperty` | object | Resolved property details |
| `epc` | object | Energy Performance Certificate data |
| `epc.available` | boolean | Whether EPC data was found |
| `epc.floorAreaSqm` | number | Floor area in square meters |
| `epc.floorAreaSqFt` | number | Floor area in square feet |
| `epc.habitableRooms` | number | Number of habitable rooms |
| `epc.rating` | string | EPC rating (A-G) |
| `streetViewUrl` | string | Google Street View image URL |
| `streetViewAvailable` | boolean | Whether street view image exists |
| `marketValue` | object | Market value band (low/central/high) |
| `conservativeMarketValue` | object | Conservative value with penalties applied |
| `offers.fastTrack` | number | Fast track offer (80% of conservative) |
| `offers.flexible` | number | Flexible offer (90% of conservative) |
| `offers.selectedOfferType` | string | Recommended offer type based on timeline |
| `confidence.score` | number | Confidence score (0-100) |
| `confidence.label` | string | `excellent` (80+), `good` (60-79), `fair` (40-59), `low` (<40) |
| `deskReview` | boolean | Whether manual review is required |
| `deskReviewReason` | string | Reason for desk review (if applicable) |
| `diagnostics` | object | Detailed calculation diagnostics |
| `comparables` | object | Comparable properties used/rejected |

---

## Error Responses

### 400 Bad Request
```json
{
  "error": "Invalid request",
  "details": ["addressLine1 is required", "propertyType must be one of: house, flat, bungalow"]
}
```

### 401 Unauthorized
```json
{
  "error": "Unauthorized",
  "details": "HMAC signature verification failed"
}
```

### 404 Not Found
```json
{
  "error": "Could not match house number \"10\" to any address at SW1A 2AA"
}
```

### 429 Too Many Requests
```json
{
  "error": "Too Many Requests",
  "details": "Rate limit exceeded. Maximum 10 requests per hour.",
  "retryAfter": 3600
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "reference": "error-ref-123"
}
```

---

## Desk Review Reasons

When `deskReview: true`, the `deskReviewReason` will be one of:

| Reason | Description |
|--------|-------------|
| `insufficient_comps` | Not enough comparable properties found |
| `missing_floor_area` | Subject property floor area not available |
| `extreme_variance` | Comparable prices vary too widely |
| `stale_data` | Comparable sales are too old |
| `fetch_error` | Error fetching data from external APIs |
| `address_not_found` | Could not resolve the property address |
| `no_epc_data` | No EPC data available for property |

---

## Confidence Scoring

| Score Range | Label | Interpretation |
|-------------|-------|----------------|
| 80-100 | `excellent` | High confidence in valuation |
| 60-79 | `good` | Good confidence, minor uncertainty |
| 40-59 | `fair` | Moderate confidence, review recommended |
| 0-39 | `low` | Low confidence, desk review likely |

Factors affecting confidence:
- Number of comparable sales
- Recency of comparable sales
- Price variance among comparables
- Distance of comparables from subject
- Quality of floor area data

