# Environment Variables

## Required Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `IDEAL_POSTCODES_API_KEY` | Ideal Postcodes API for UPRN lookup, address normalization, lat/lng coordinates | `ak_xxxxx` |
| `PROPERTYDATA_API_KEY` | PropertyData API for comparable sales, EPC data, Land Registry access | `XXXXXXXXXX` |
| `GOOGLE_MAPS_API_KEY` | Google Street View Static API for property images | `AIzaSyXXXXX` |
| `SUPABASE_URL` | Supabase project URL | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (server-side only) | `eyJhbGciOiJIUzI1NiIs...` |
| `HMAC_SECRET` | Secret for HMAC signature verification from Webflow | Random 32+ char string |

## Setting Variables

### Local Development

Create `.env.local` file (gitignored):

```bash
# Copy the example file
cp .env.example .env.local

# Edit with your actual values
```

### Vercel Deployment

```bash
# Add each variable via CLI
vercel env add IDEAL_POSTCODES_API_KEY
vercel env add PROPERTYDATA_API_KEY
vercel env add GOOGLE_MAPS_API_KEY
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_KEY
vercel env add HMAC_SECRET
```

Or use the Vercel dashboard:
1. Go to Project Settings → Environment Variables
2. Add each variable for Production/Preview/Development

## Security Rules

- ❌ NEVER commit `.env` files or actual secret values
- ❌ NEVER hardcode keys in source code
- ✅ Use Vercel environment variables for deployment
- ✅ Use `.env.local` for local development only
- ✅ Rotate keys if they are ever exposed

## API Key Sources

| Service | Get Key From |
|---------|--------------|
| Ideal Postcodes | https://ideal-postcodes.co.uk/dashboard |
| PropertyData | https://propertydata.co.uk/dashboard |
| Google Maps | https://console.cloud.google.com/apis/credentials |
| Supabase | https://supabase.com/dashboard/project/_/settings/api |

