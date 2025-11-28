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
import { resolveSubjectProperty } from '../src/engine/addressResolver';
import { validateConfig } from '../src/utils/config';

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

  // Test each service
  console.log('🧪 Testing External Services:\n');

  // 1. Ideal Postcodes
  console.log('1️⃣  Ideal Postcodes (Address Lookup)...');
  const idealResult = await idealPostcodesHealth();
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

  // Test address resolution
  console.log('\n' + '='.repeat(50));
  console.log('\n🏠 Testing Address Resolution:\n');

  const testAddress = {
    addressLine1: '24 Meadow View',
    postcode: 'LE16 9XP',
    propertyType: 'house' as const,
  };

  console.log(`   Input: ${testAddress.addressLine1}, ${testAddress.postcode}`);
  console.log('   Resolving...\n');

  const addressResult = await resolveSubjectProperty(testAddress);

  if (addressResult.success) {
    console.log('   ✅ Address resolved successfully!');
    console.log(`   📍 Address: ${addressResult.property.normalizedAddress}`);
    console.log(`   🔑 UPRN: ${addressResult.property.uprn}`);
    console.log(
      `   🌍 Coordinates: ${addressResult.property.latitude}, ${addressResult.property.longitude}`
    );
    console.log(
      `   📐 Floor Area: ${addressResult.property.floorAreaSqm ? `${addressResult.property.floorAreaSqm} sqm` : 'Not available'}`
    );
    console.log(`   ⚡ EPC Rating: ${addressResult.property.epcRating || 'Not available'}`);
  } else {
    console.log('   ❌ Address resolution failed');
    console.log(`   Error: ${addressResult.error}`);
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  const allResults = [idealResult, pdResult, svResult, hpiResult, supaResult];
  const passCount = allResults.filter((r) => r.ok).length;
  const totalCount = allResults.length;

  console.log(`\n📊 Summary: ${passCount}/${totalCount} services passed\n`);

  if (passCount === totalCount) {
    console.log('🎉 All integration tests passed! Ready for deployment.\n');
  } else {
    console.log('⚠️  Some services failed. Check the errors above.\n');
  }
}

main().catch(console.error);

