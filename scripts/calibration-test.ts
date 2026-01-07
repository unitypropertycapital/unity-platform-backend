/**
 * Calibration Test Script
 * 
 * Tests key properties from the calibration sheet to verify
 * the conservative valuation mode is working correctly.
 * 
 * Run with: npx ts-node --project scripts/tsconfig.json scripts/calibration-test.ts
 */

import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const HMAC_SECRET = process.env.HMAC_SECRET || 'test-secret-key';

interface TestCase {
  name: string;
  addressLine1: string;
  houseNumber: string;  // Used for /api/address/resolve
  postcode: string;
  propertyType: 'house' | 'flat' | 'bungalow';
  category: string;
  zooplaLow?: number;
  zooplaCentral?: number;
  zooplaHigh?: number;
  targetRatioMin: number;
  targetRatioMax: number;
}

const TEST_CASES: TestCase[] = [
  // Standard House - should have minimal penalties
  {
    name: '14 Kingsway, Rugby',
    addressLine1: '14 Kingsway',
    houseNumber: '14',  // Just the number for address resolution
    postcode: 'CV22 5NU',
    propertyType: 'house',
    category: 'Standard House',
    targetRatioMin: 0.85,
    targetRatioMax: 0.95,
  },
  // Ex-LA Tower Flat - should have significant penalties
  {
    name: 'Flat 45 Sudbury House, London',
    addressLine1: 'Flat 45 Sudbury House',
    houseNumber: 'Flat 45 Sudbury House',  // Full flat identifier for resolution
    postcode: 'SW18 4LH',
    propertyType: 'flat',
    category: 'Ex-LA Tower Flat',
    zooplaLow: 216000,
    zooplaCentral: 269000,
    zooplaHigh: 323000,
    targetRatioMin: 0.80,
    targetRatioMax: 0.90,
  },
  // Private City Flat - moderate penalties
  {
    name: 'Flat 75, Princess Court, Manchester',
    addressLine1: 'Flat 75 Princess Court',
    houseNumber: 'Flat 75 Princess Court',  // Full flat identifier
    postcode: 'M15 4FF',
    propertyType: 'flat',
    category: 'Private City Flat',
    zooplaLow: 119000,
    zooplaCentral: 149000,
    zooplaHigh: 179000,
    targetRatioMin: 0.90,
    targetRatioMax: 0.97,
  },
  // Ex-LA Tower Flat - key calibration case
  {
    name: 'Flat 12, Maydwell House, London',
    addressLine1: 'Flat 12 Maydwell House',
    houseNumber: 'Flat 12 Maydwell House',  // Full flat identifier
    postcode: 'E14 7AP',
    propertyType: 'flat',
    category: 'Ex-LA Tower Flat',
    zooplaLow: 245000,
    zooplaCentral: 306000,
    zooplaHigh: 367000,
    targetRatioMin: 0.80,
    targetRatioMax: 0.90,
  },
];

function generateHmac(data: object): string {
  const payload = JSON.stringify(data);
  return crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('hex');
}

async function makeRequest(url: string, method: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const bodyString = body ? JSON.stringify(body) : '';
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyString),
      },
    };

    const req = httpModule.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (bodyString) {
      req.write(bodyString);
    }
    req.end();
  });
}

/**
 * Step 1: Resolve the address to get an addressId
 * 
 * API: POST /api/address/resolve
 * Request: { postcode: string, houseNumber: string }
 * Response: { id: string, address_line_1: string, ... }
 */
async function resolveAddress(postcode: string, houseNumber: string): Promise<{ success: boolean; addressId?: string; error?: string; addressLine1?: string }> {
  const url = `${BASE_URL}/api/address/resolve`;
  
  const body = {
    postcode,
    houseNumber,  // This is the correct field name per src/types/address.ts
  };
  
  console.log(`  Resolving address: ${houseNumber}, ${postcode}...`);
  
  const result = await makeRequest(url, 'POST', body);
  
  if (result.error) {
    return { success: false, error: result.error + (result.details ? `: ${JSON.stringify(result.details)}` : '') };
  }
  
  // Response uses snake_case: id, address_line_1 (per src/types/address.ts)
  if (result.id) {
    return { 
      success: true, 
      addressId: result.id,
      addressLine1: result.address_line_1 || houseNumber,
    };
  }
  
  return { success: false, error: 'No address ID returned' };
}

/**
 * Step 2: Get valuation using the addressId
 */
async function getValuation(
  addressId: string,
  addressLine1: string,
  postcode: string,
  propertyType: 'house' | 'flat' | 'bungalow'
): Promise<any> {
  const url = `${BASE_URL}/api/valuation`;
  
  // Build the full request body
  const requestData = {
    addressId,
    addressLine1,
    postcode,
    propertyType,
    saleTimeline: '8-16_weeks',
    reasonForSelling: 'Testing',
    source: 'calibration-test',
    consent: true,
  };
  
  // Generate HMAC
  const hmac = generateHmac(requestData);
  
  const body = {
    ...requestData,
    hmac,
  };
  
  console.log(`  Getting valuation with addressId: ${addressId}...`);
  
  return makeRequest(url, 'POST', body);
}

async function runTest(testCase: TestCase): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log(`TEST: ${testCase.name}`);
  console.log(`Category: ${testCase.category}`);
  console.log(`Property Type: ${testCase.propertyType}`);
  console.log('='.repeat(80));

  try {
    // Step 1: Resolve address
    const addressResult = await resolveAddress(testCase.postcode, testCase.houseNumber);
    
    if (!addressResult.success) {
      console.log(`\n❌ ADDRESS RESOLUTION FAILED: ${addressResult.error}`);
      return;
    }
    
    console.log(`  ✓ Address resolved: ${addressResult.addressLine1}`);
    
    // Step 2: Get valuation
    const result = await getValuation(
      addressResult.addressId!,
      addressResult.addressLine1!,
      testCase.postcode,
      testCase.propertyType
    );

    if (result.error) {
      console.log(`\n❌ VALUATION ERROR: ${result.error}`);
      if (result.details) {
        console.log(`   Details: ${JSON.stringify(result.details)}`);
      }
      return;
    }

    if (result.deskReview) {
      console.log(`\n⚠️  DESK REVIEW: ${result.deskReviewReason}`);
      if (result.comparables) {
        console.log(`   Comps found: ${result.comparables.totalFound}`);
        console.log(`   Comps kept: ${result.comparables.totalKept}`);
      }
      return;
    }

    // Extract key values
    const marketValue = result.marketValue;
    const conservativeValue = result.conservativeMarketValue;
    const diagnostics = result.conservativeDiagnostics;
    const confidence = result.confidence;
    const epc = result.epc;

    console.log('\n📊 RESULTS:');
    console.log('-'.repeat(50));
    
    // EPC Info
    if (epc && epc.available) {
      console.log(`\n🏠 EPC Data:`);
      console.log(`  Floor Area: ${epc.floorAreaSqm} sqm (${epc.floorAreaSqFt} sqft)`);
      console.log(`  Rating: ${epc.rating} (Score: ${epc.score})`);
      console.log(`  Habitable Rooms: ${epc.habitableRooms}`);
    }
    
    if (marketValue) {
      console.log(`\n💰 Market Value (Original - Weighted Median):`);
      console.log(`  Low:     £${marketValue.low?.toLocaleString()}`);
      console.log(`  Central: £${marketValue.central?.toLocaleString()}`);
      console.log(`  High:    £${marketValue.high?.toLocaleString()}`);
    }

    if (conservativeValue) {
      console.log(`\n💰 Conservative Market Value (P25/Median + Penalties):`);
      console.log(`  Low:     £${conservativeValue.low?.toLocaleString()}`);
      console.log(`  Central: £${conservativeValue.central?.toLocaleString()}`);
      console.log(`  High:    £${conservativeValue.high?.toLocaleString()}`);
    }

    if (confidence) {
      console.log(`\n📈 Confidence: ${confidence.score} (${confidence.label})`);
    }

    if (diagnostics) {
      console.log(`\n🔧 CONSERVATIVE DIAGNOSTICS:`);
      console.log(`  P25 £/sqm:           ${diagnostics.p25Psqm?.toLocaleString() || 'N/A'}`);
      console.log(`  Median £/sqm:        ${diagnostics.medianPsqm?.toLocaleString() || 'N/A'}`);
      console.log(`  Base £/sqm:          ${diagnostics.basePsqm?.toLocaleString() || 'N/A'}`);
      console.log(`  Is Flat Block:       ${diagnostics.isFlatBlock}`);
      console.log(`  Ex-LA Score:         ${diagnostics.exLAScore}`);
      console.log(`  Is Ex-LA:            ${diagnostics.isExLocalAuthority}`);
      console.log(`  --------- PENALTIES ---------`);
      console.log(`  Block Penalty:       ${((diagnostics.blockPenalty || 0) * 100).toFixed(1)}%`);
      console.log(`  Small Unit Penalty:  ${((diagnostics.smallUnitPenalty || 0) * 100).toFixed(1)}%`);
      console.log(`  Confidence Penalty:  ${((diagnostics.confidencePenalty || 0) * 100).toFixed(1)}%`);
      console.log(`  CV Penalty:          ${((diagnostics.cvPenalty || 0) * 100).toFixed(1)}%`);
      console.log(`  TOTAL PENALTY:       ${((diagnostics.totalPenalty || 0) * 100).toFixed(1)}%`);
      console.log(`  --------- VALUES ---------`);
      console.log(`  Raw Value:           £${diagnostics.rawValue?.toLocaleString() || 'N/A'}`);
      console.log(`  Conservative:        £${diagnostics.conservativeCentral?.toLocaleString() || 'N/A'}`);
    }

    // Compare with Zoopla if available
    if (testCase.zooplaCentral && conservativeValue?.central) {
      const ratio = conservativeValue.central / testCase.zooplaCentral;
      const percentDiff = ((ratio - 1) * 100).toFixed(1);
      const inRange = ratio >= testCase.targetRatioMin && ratio <= testCase.targetRatioMax;

      console.log(`\n📊 VS ZOOPLA:`);
      console.log(`  Zoopla Central:      £${testCase.zooplaCentral.toLocaleString()}`);
      console.log(`  Moov Conservative:   £${conservativeValue.central.toLocaleString()}`);
      console.log(`  Moov/Zoopla Ratio:   ${(ratio * 100).toFixed(1)}%`);
      console.log(`  Target Range:        ${(testCase.targetRatioMin * 100).toFixed(0)}% - ${(testCase.targetRatioMax * 100).toFixed(0)}%`);
      console.log(`  Diff vs Zoopla:      ${percentDiff}%`);
      console.log(`  ======> Status:      ${inRange ? '✅ PASS' : '❌ CHECK'}`);
    }

    // Show offers
    if (result.offers) {
      console.log(`\n💵 OFFERS (based on conservative value):`);
      console.log(`  Fast-Track: £${result.offers.fastTrack?.low?.toLocaleString()} - £${result.offers.fastTrack?.high?.toLocaleString()}`);
      console.log(`  Flexible:   £${result.offers.flexible?.low?.toLocaleString()} - £${result.offers.flexible?.high?.toLocaleString()}`);
      console.log(`  Selected:   ${result.offers.selectedOfferType}`);
    }
    
    // Comparables summary
    if (result.comparables) {
      console.log(`\n📋 COMPARABLES:`);
      console.log(`  Radius Used: ${result.comparables.radiusUsed} miles`);
      console.log(`  Total Found: ${result.comparables.totalFound}`);
      console.log(`  Total Kept:  ${result.comparables.totalKept}`);
    }

  } catch (error: any) {
    console.log(`\n❌ ERROR: ${error.message}`);
  }
}

async function main(): Promise<void> {
  console.log('🏠 MOOV CALIBRATION TEST - CONSERVATIVE VALUATION MODE');
  console.log(`API URL: ${BASE_URL}`);
  console.log(`Running ${TEST_CASES.length} test cases...\n`);

  for (const testCase of TEST_CASES) {
    await runTest(testCase);
  }

  console.log('\n' + '='.repeat(80));
  console.log('CALIBRATION TESTS COMPLETE');
  console.log('='.repeat(80));
}

main().catch(console.error);






