# Outlier Detection (IQR Method)

## How It Works

```
1. Collect all pricePerSqm values from comps
2. Sort and find Q1 (25%) and Q3 (75%)
3. Calculate IQR = Q3 - Q1
4. Set bounds using 1.5× multiplier
5. Reject comps outside bounds
```

## Formula

```
Lower Bound = Q1 - (1.5 × IQR)
Upper Bound = Q3 + (1.5 × IQR)
```

## Diagram

```
Price/sqm Distribution:

     £3K        £9K    £10.5K       £12.75K            £25K
      │          │        │            │                 │
      ▼          ▼        ▼            ▼                 ▼
──────┼──────────┼────────┼────────────┼─────────────────┼──────►
      │          │   IQR  │            │                 │
      │         Q1───────Q3            │                 │
      │          │        │            │                 │
   OUTLIER      └────┬────┘         UPPER             OUTLIER
    LOW              │              BOUND               HIGH
                   1500
                     │
         ┌───────────┴───────────┐
         │                       │
    1.5 × 1500              1.5 × 1500
      = 2250                  = 2250
         │                       │
         ▼                       ▼
   9000 - 2250            10500 + 2250
      = 6750                 = 12750
         │                       │
      LOWER                   UPPER
      BOUND                   BOUND
```

## Example

| Comp | Price/sqm | Result |
|------|-----------|--------|
| A | £8,000 | ✅ KEPT |
| B | £9,500 | ✅ KEPT |
| C | £10,000 | ✅ KEPT |
| D | £3,000 | ❌ `outlier_low` |
| E | £25,000 | ❌ `outlier_high` |

## Rejection Output

```json
{
  "reason": "outlier_high",
  "details": "Price £25000/sqm is above IQR upper bound (£12750/sqm)"
}
```

## Requirements

- Minimum **4 comps** with valid `pricePerSqm` data
- All kept comps MUST have `floorAreaSqm` (comps without floor area are rejected)
- `pricePerSqm` = `salePrice` / `floorAreaSqm`

## Filter Order

```
1. Property type filter     → wrong_property_type
2. Recency filter (24mo)    → too_old
3. Floor area filter        → no_floor_area  ← Required for £/sqm
4. Size tolerance (±20%)    → size_mismatch
5. IQR outlier detection    → outlier_high / outlier_low
```

## Important

Comps with `floorAreaSqm: null` are now **rejected** with reason `no_floor_area`.
Only comps with valid floor area can be kept and used for valuation.


