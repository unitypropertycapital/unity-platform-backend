# API Call Analysis per Valuation Request

## Current State: 6-12+ API calls per valuation

### 1. Address Resolution (`/api/address/resolve`) - Called separately
| API | Endpoint | Calls |
|-----|----------|-------|
| Ideal Postcodes | `/postcodes/{postcode}` | **1** |

**Note:** This is cached in Supabase - subsequent lookups for the same address skip the API call.

---

### 2. Valuation Request (`/api/valuation`)

#### Called in Parallel:

| API | Endpoint | Purpose | Calls |
|-----|----------|---------|-------|
| Google Street View | `/metadata?location=` | Check image availability | **1** |
| Gov EPC (UK Gov) | `/domestic/search?uprn=` | Construction age, floor count | **1** |
| Gov EPC (fallback) | `/domestic/search?postcode=` | If UPRN fails | **(+1)** |
| PropertyData | `/energy-efficiency?postcode=` | Subject EPC rating | **1** |
| PropertyData | `/floor-areas?postcode=` | Subject floor area | **1** |
| PropertyData | `/sold-prices?postcode=` | Fetch all comps | **1** |

#### Then: Comparable Enrichment (Sequential with 200ms delay)

| API | Endpoint | Purpose | Calls |
|-----|----------|---------|-------|
| PropertyData | `/floor-areas?postcode=` | Floor area for each unique postcode in comps | **1-5+** |

---

## Total Calls Breakdown

| Scenario | Total PropertyData Calls | Total All APIs |
|----------|-------------------------|----------------|
| **Best case** (all comps same postcode) | 3 | 6-7 |
| **Typical** (2-3 unique postcodes in comps) | 5-6 | 8-10 |
| **Worst case** (5+ unique postcodes) | 8+ | 12+ |

---

## The Problem: PropertyData `/floor-areas` Calls

The **major cost driver** is comparable enrichment:

```
Comps from postcode SW1A 1AA, SW1A 2AA, SW1B 1CD, SW1C 2DE
= 4 additional API calls just for floor areas!
```

Each unique postcode in the comparables triggers a separate `/floor-areas` call.

---

## Proposed Optimizations to Get to 1-2 Calls

### Option A: Single Postcode Floor Area (Recommended)

1. **Combine subject + comp floor area lookups**
   - Fetch `/floor-areas` for subject postcode ONCE
   - Apply to subject AND any comps in same postcode
   - Skip enrichment for comps in different postcodes (accept missing floor area)

2. **Skip Gov EPC if PropertyData has data**
   - PropertyData floor-areas often includes same data
   - Only call Gov EPC when needed for ex-LA detection

3. **Make Street View optional**
   - Only fetch on demand, not every valuation

**Result: 2-3 calls**
- 1x `/sold-prices`
- 1x `/floor-areas` (subject postcode only)
- 1x Gov EPC (only if needed for flats)

### Option B: Accept Comps Without Floor Area

1. For comps outside subject postcode, use price-only valuation
2. Skip floor area enrichment entirely for comps
3. Use median £/sqm from comps that DO have floor area

**Result: 2 calls**
- 1x `/sold-prices`
- 1x `/floor-areas` (subject only)

### Option C: Batch Postcode Lookup (Requires API Change)

If PropertyData supported batch requests like `/floor-areas?postcodes=SW1A,SW1B,SW1C`, we could do:
- 1x `/sold-prices`
- 1x `/floor-areas` (multiple postcodes)

**But this isn't currently supported by PropertyData.**

---

## Current Code Locations

| File | Function | API Calls |
|------|----------|-----------|
| `src/services/propertyData.ts` | `getSoldPrices()` | 1x `/sold-prices` |
| `src/services/epc.ts` | `getFloorArea()` | 2x PropertyData (energy + floor) |
| `src/services/govEpc.ts` | `getGovEpcData()` | 1-2x Gov EPC |
| `src/services/streetView.ts` | `getStreetViewImage()` | 1x Street View |
| `src/engine/comparables/enricher.ts` | `enrichWithFloorArea()` | **N x `/floor-areas`** ← THE PROBLEM |

---

## Recommendation

**Implement Option A (Single Postcode Floor Area):**

1. Modify `enrichWithFloorArea()` to only use subject postcode
2. Skip floor area for comps in different postcodes
3. Filter out comps without floor area if we can't value them

This gets us to **2-3 PropertyData calls per valuation** (subject floor area + sold prices).













