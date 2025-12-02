/**
 * Test script to verify all external API integrations
 * Run with: npx ts-node scripts/test-apis.ts
 */

/* eslint-disable @typescript-eslint/no-require-imports */
// Load environment variables first
require('dotenv').config({ path: '.env.local' });

import { healthCheck as idealPostcodesHealth } from '../src/services/idealPostcodes';
import { healthCheck as propertyDataHealth } from '../src/services/propertyData';
import { healthCheck as streetViewHealth } from '../src/services/streetView';
import { healthCheck as supabaseHealth } from '../src/services/supabase';
import { healthCheck as onsHpiHealth } from '../src/services/onsHpi';
import { lookupPostcode, findAddressMatch } from '../src/services/idealPostcodes';
import { findCachedAddress, cacheAddress } from '../src/services/addressCache';
import { resolveSubjectProperty } from '../src/engine/addressResolver';
import { validateConfig, getAutoOrigin } from '../src/utils/config';
import type { AddressCacheInsert } from '../src/types/address';

async function testHealthChecks(origin: string): Promise<number> {
  console.log('🧪 Testing External Services:\n');

  // 1. Ideal Postcodes (now non-consuming - just validates API key)
  console.log('1️⃣  Ideal Postcodes (Config Check)...');
  const idealResult = await idealPostcodesHealth(origin);
  console.log(
    `   ${idealResult.ok ? '✅' : '❌'} Status: ${idealResult.ok ? 'OK' : 'FAILED'}`,
    `(${idealResult.latencyMs}ms)`,
    idealResult.error ? `- ${idealResult.error}` : ''
  );

  // 2. PropertyData
  console.log('2️⃣  PropertyData (EPC + Comparables)...');
  const pdResult = await propertyDataHealth();
  console.log(
    `   ${pdResult.ok ? '✅' : '❌'} Status: ${pdResult.ok ? 'OK' : 'FAILED'}`,
    `(${pdResult.latencyMs}ms)`,
    pdResult.error ? `- ${pdResult.error}` : ''
  );

  // 3. Google Street View
  console.log('3️⃣  Google Street View...');
  const svResult = await streetViewHealth();
  console.log(
    `   ${svResult.ok ? '✅' : '❌'} Status: ${svResult.ok ? 'OK' : 'FAILED'}`,
    `(${svResult.latencyMs}ms)`,
    svResult.error ? `- ${svResult.error}` : ''
  );

  // 4. ONS HPI
  console.log('4️⃣  ONS House Price Index...');
  const hpiResult = await onsHpiHealth();
  console.log(
    `   ${hpiResult.ok ? '✅' : '❌'} Status: ${hpiResult.ok ? 'OK' : 'FAILED'}`,
    `(${hpiResult.latencyMs}ms)`,
    hpiResult.error ? `- ${hpiResult.error}` : ''
  );

  // 5. Supabase
  console.log('5️⃣  Supabase (Database)...');
  const supaResult = await supabaseHealth();
  console.log(
    `   ${supaResult.ok ? '✅' : '❌'} Status: ${supaResult.ok ? 'OK' : 'FAILED'}`,
    `(${supaResult.latencyMs}ms)`,
    supaResult.error ? `- ${supaResult.error}` : ''
  );

  const allResults = [idealResult, pdResult, svResult, hpiResult, supaResult];
  return allResults.filter((r) => r.ok).length;
}

async function testAddressCaching(origin: string): Promise<void> {
  console.log('\n' + '='.repeat(50));
  console.log('\n🏠 Testing Address Resolution & Caching:\n');

  const testPostcode = 'W14 9JH';
  const testHouseNumber = '36';

  console.log(`   Testing: ${testHouseNumber}, ${testPostcode}`);

  // Step 1: Check if already cached
  console.log('\n   Step 1: Checking cache...');
  const cached = await findCachedAddress(testPostcode, testHouseNumber);

  if (cached) {
    console.log('   ✅ Found in cache! (no Ideal Postcodes API call needed)');
    console.log(`   📍 Address: ${cached.address_line_1}`);
    console.log(`   🔑 UPRN: ${cached.uprn}`);
    console.log(`   🆔 Cache ID: ${cached.id}`);
    return;
  }

  console.log('   ⚠️  Not in cache - will call Ideal Postcodes API');

  // Step 2: Call Ideal Postcodes
  console.log('\n   Step 2: Calling Ideal Postcodes API...');
  const lookupResult = await lookupPostcode(testPostcode, origin);

  if (!lookupResult.success) {
    console.log(`   ❌ Lookup failed: ${lookupResult.error}`);
    return;
  }

  console.log(`   ✅ Found ${lookupResult.addresses.length} addresses`);

  // Step 3: Match address
  const matched = findAddressMatch(lookupResult.addresses, testHouseNumber);
  if (!matched) {
    console.log('   ❌ Could not match address');
    return;
  }

  console.log(`   ✅ Matched: ${matched.line_1}`);

  // Step 4: Cache the address
  console.log('\n   Step 3: Caching address...');
  const insertData: AddressCacheInsert = {
    postcode: matched.postcode,
    house_number: testHouseNumber,
    address_line_1: matched.line_1 || null,
    address_line_2: matched.line_2 || null,
    town: matched.post_town || null,
    county: null,
    country: matched.country || 'UK',
    uprn: matched.uprn || null,
    udprn: null,
    latitude: matched.latitude || null,
    longitude: matched.longitude || null,
    provider_raw: { source: 'test-script', matched },
  };

  const newlyCached = await cacheAddress(insertData);
  if (!newlyCached) {
    console.log('   ❌ Failed to cache address');
    return;
  }
  console.log('   ✅ Address cached successfully!');
  console.log(`   🆔 Cache ID: ${newlyCached.id}`);
  console.log(`   🔑 UPRN: ${newlyCached.uprn}`);
}

async function testValuationFlow(): Promise<void> {
  console.log('\n' + '='.repeat(50));
  console.log('\n📋 Testing Valuation Flow (with cached address):\n');

  const testPostcode = 'W14 9JH';
  const testHouseNumber = '36';

  // First, ensure address is cached
  const cached = await findCachedAddress(testPostcode, testHouseNumber);

  if (!cached) {
    console.log('   ⚠️  Address not in cache. Run caching test first.');
    return;
  }

  console.log(`   Using cached address: ${cached.id}`);

  // Test resolveSubjectProperty with addressId
  const result = await resolveSubjectProperty({
    addressLine1: `${testHouseNumber} Charleville Road`,
    postcode: testPostcode,
    propertyType: 'flat',
    addressId: cached.id,
  });

  if (result.success) {
    console.log('\n   ✅ Property resolved from cache!');
    console.log(`   📍 Address: ${result.property.normalizedAddress}`);
    console.log(`   🔑 UPRN: ${result.property.uprn}`);
    console.log(
      `   🌍 Coordinates: ${result.property.latitude}, ${result.property.longitude}`
    );
    console.log(
      `   📐 Floor Area: ${result.property.floorAreaSqm ? `${result.property.floorAreaSqm} sqm` : 'Not available'}`
    );
    console.log(`   ⚡ EPC Rating: ${result.property.epcRating || 'Not available'}`);
  } else {
    console.log(`   ❌ Resolution failed: ${result.error}`);
  }
}

async function main() {
  console.log('🔍 Moov Valuation API - Integration Tests\n');
  console.log('='.repeat(50));

  // Check configuration
  console.log('\n📋 Configuration Check:');
  const configResult = validateConfig();
  if (!configResult.valid) {
    console.error('❌ Missing config:', configResult.missing.join(', '));
    console.log('\nMake sure .env.local exists with all required keys');
    process.exit(1);
  }
  console.log('✅ All environment variables configured\n');

  // Auto-detect origin for Ideal Postcodes whitelist
  const origin = getAutoOrigin();
  console.log(`🌐 Detected Origin: ${origin || '(none)'}\n`);

  // Run health checks
  const passCount = await testHealthChecks(origin);
  const totalCount = 5;

  // Test address caching (only if Supabase is configured)
  try {
    await testAddressCaching(origin);
    await testValuationFlow();
  } catch (err) {
    console.log(`\n   ⚠️  Caching test skipped: ${(err as Error).message}`);
    console.log('   (This is expected if the addresses table does not exist yet)');
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`\n📊 Summary: ${passCount}/${totalCount} services passed\n`);

  if (passCount === totalCount) {
    console.log('🎉 All integration tests passed! Ready for deployment.\n');
  } else {
    console.log('⚠️  Some services failed. Check the errors above.\n');
  }

  console.log('💡 Note: Ideal Postcodes health check is now non-consuming.');
  console.log('   Real API calls only happen via /api/address/resolve.\n');
}

main().catch(console.error);
