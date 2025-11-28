# Moov Valuation API

A serverless property valuation API for Moov Homes. Generates instant property valuations, offer ranges, and confidence scores using UK property data sources.

## Tech Stack

- **Runtime**: Node.js 18+ with TypeScript
- **Hosting**: Vercel (Serverless Functions)
- **Database**: Supabase (PostgreSQL)

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check for all external services |
| `/api/valuation` | POST | Property valuation request |

## External Services

| Service | Purpose |
|---------|---------|
| Ideal Postcodes | Address lookup, UPRN, coordinates |
| PropertyData | Comparable sales, EPC data |
| Google Street View | Property images |
| Supabase | Database storage |
| ONS HPI | House price index adjustments |

## Project Structure

```
moov/
├── api/
│   ├── health.ts         # GET /api/health
│   └── valuation.ts      # POST /api/valuation
├── src/
│   ├── engine/
│   │   └── addressResolver.ts
│   ├── services/
│   │   ├── idealPostcodes.ts
│   │   ├── propertyData.ts
│   │   ├── epc.ts
│   │   ├── landRegistry.ts
│   │   ├── onsHpi.ts
│   │   ├── streetView.ts
│   │   └── supabase.ts
│   ├── types/
│   │   ├── property.ts
│   │   ├── request.ts
│   │   ├── response.ts
│   │   └── services.ts
│   └── utils/
│       ├── config.ts
│       ├── httpClient.ts
│       ├── logger.ts
│       └── requestOrigin.ts
├── docs/
│   ├── ENVIRONMENT.md
│   └── supabase-schema.sql
└── package.json
```

## Getting Started

### Prerequisites

- Node.js 18+
- Vercel CLI (`npm i -g vercel`)

### Installation

```bash
npm install
```

### Environment Setup

Create a `.env.local` file:

```env
IDEAL_POSTCODES_API_KEY=your_key
PROPERTYDATA_API_KEY=your_key
GOOGLE_MAPS_API_KEY=your_key
SUPABASE_URL=your_url
SUPABASE_SERVICE_KEY=your_key
HMAC_SECRET=your_secret
```

See `docs/ENVIRONMENT.md` for details.

### Database Setup

Run `docs/supabase-schema.sql` in your Supabase SQL Editor.

### Run Locally

```bash
npx vercel dev
```

### Test Health Check

```bash
curl http://localhost:3000/api/health
```

## Code Quality Standards

- TypeScript only
- Functions under 80 lines
- One file per responsibility
- async/await (no nested promises)
- Strong typing for all API responses
- Centralized error handling
- All external API calls include:
  - Timeout (1500ms default)
  - Retry (2 attempts)
  - Logging

## Deployment

```bash
# Deploy to preview
npx vercel

# Deploy to production
npx vercel --prod
```

## License

Proprietary - Moov Homes / Unity Property


