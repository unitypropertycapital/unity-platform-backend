import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';

const BASE_URL = 'http://localhost:3000';
const HMAC_SECRET = 'test-secret-key';

function generateHmac(data: object): string {
  return crypto.createHmac('sha256', JSON.stringify(data)).update(JSON.stringify(data)).digest('hex');
}

async function makeRequest(url: string, method: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const httpModule = parsedUrl.protocol === 'https:' ? https : http;
    const bodyString = body ? JSON.stringify(body) : '';
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname,
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
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (bodyString) req.write(bodyString);
    req.end();
  });
}

async function resolveAddress(postcode: string, houseNumber: string) {
  const result = await makeRequest(`${BASE_URL}/api/address/resolve`, 'POST', { postcode, houseNumber });
  return result.id ? { success: true, addressId: result.id } : { success: false, error: result.error || 'No ID' };
}

async function getValuation(addressId: string, addressLine1: string, postcode: string, propertyType: string) {
  const data = { addressId, addressLine1, postcode, propertyType, saleTimeline: '8-16_weeks', reasonForSelling: 'Test', source: 'test', consent: true };
  const body = { ...data, hmac: generateHmac(data) };
  return await makeRequest(`${BASE_URL}/api/valuation`, 'POST', body);
}

async function test(name: string, houseNumber: string, postcode: string, type: string, zoopla: number, targetMin: number, targetMax: number) {
  console.log(`\nTesting: ${name}`);
  const addr = await resolveAddress(postcode, houseNumber);
  if (!addr.success) { console.log(`  ❌ Address failed: ${addr.error}`); return; }
  
  const val = await getValuation(addr.addressId!, houseNumber, postcode, type);
  if (val.error) { console.log(`  ❌ Error: ${val.error}`); return; }
  if (val.deskReview) { console.log(`  ⚠️  Desk: ${val.deskReviewReason}`); return; }
  
  const cons = val.conservativeMarketValue?.central;
  const diag = val.conservativeDiagnostics;
  const ratio = cons / zoopla;
  const inTarget = ratio >= targetMin && ratio <= targetMax;
  
  console.log(`  Conservative: £${cons.toLocaleString()}`);
  console.log(`  Ratio: ${ratio.toFixed(2)} (target ${targetMin}-${targetMax}) ${inTarget ? '✅' : '❌'}`);
  if (diag) {
    console.log(`  Penalties: Block ${(diag.blockPenalty*100).toFixed(0)}%, Small ${(diag.smallUnitPenalty*100).toFixed(0)}%, Conf ${(diag.confidencePenalty*100).toFixed(0)}%, CV ${(diag.cvPenalty*100).toFixed(0)}%`);
  }
}

(async () => {
  console.log('🧪 Quick Penalty Test - Reduced Penalties (12% max)\n');
  await test('Flat 120 Sudbury House', 'Flat 120 Sudbury House', 'SW18 4TT', 'flat', 261000, 0.80, 0.90);
  await test('Flat 75 Princess Court', 'Flat 75 Princess Court', 'M15 4FF', 'flat', 149000, 0.90, 0.97);
  await test('27 Woodlands', '27', 'NE3 4YN', 'house', 588000, 0.85, 0.95);
  console.log('\n✅ Test complete!');
})().catch(console.error);


import * as http from 'http';
import * as crypto from 'crypto';

const BASE_URL = 'http://localhost:3000';
const HMAC_SECRET = 'test-secret-key';

function generateHmac(data: object): string {
  return crypto.createHmac('sha256', JSON.stringify(data)).update(JSON.stringify(data)).digest('hex');
}

async function makeRequest(url: string, method: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const httpModule = parsedUrl.protocol === 'https:' ? https : http;
    const bodyString = body ? JSON.stringify(body) : '';
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname,
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
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (bodyString) req.write(bodyString);
    req.end();
  });
}

async function resolveAddress(postcode: string, houseNumber: string) {
  const result = await makeRequest(`${BASE_URL}/api/address/resolve`, 'POST', { postcode, houseNumber });
  return result.id ? { success: true, addressId: result.id } : { success: false, error: result.error || 'No ID' };
}

async function getValuation(addressId: string, addressLine1: string, postcode: string, propertyType: string) {
  const data = { addressId, addressLine1, postcode, propertyType, saleTimeline: '8-16_weeks', reasonForSelling: 'Test', source: 'test', consent: true };
  const body = { ...data, hmac: generateHmac(data) };
  return await makeRequest(`${BASE_URL}/api/valuation`, 'POST', body);
}

async function test(name: string, houseNumber: string, postcode: string, type: string, zoopla: number, targetMin: number, targetMax: number) {
  console.log(`\nTesting: ${name}`);
  const addr = await resolveAddress(postcode, houseNumber);
  if (!addr.success) { console.log(`  ❌ Address failed: ${addr.error}`); return; }
  
  const val = await getValuation(addr.addressId!, houseNumber, postcode, type);
  if (val.error) { console.log(`  ❌ Error: ${val.error}`); return; }
  if (val.deskReview) { console.log(`  ⚠️  Desk: ${val.deskReviewReason}`); return; }
  
  const cons = val.conservativeMarketValue?.central;
  const diag = val.conservativeDiagnostics;
  const ratio = cons / zoopla;
  const inTarget = ratio >= targetMin && ratio <= targetMax;
  
  console.log(`  Conservative: £${cons.toLocaleString()}`);
  console.log(`  Ratio: ${ratio.toFixed(2)} (target ${targetMin}-${targetMax}) ${inTarget ? '✅' : '❌'}`);
  if (diag) {
    console.log(`  Penalties: Block ${(diag.blockPenalty*100).toFixed(0)}%, Small ${(diag.smallUnitPenalty*100).toFixed(0)}%, Conf ${(diag.confidencePenalty*100).toFixed(0)}%, CV ${(diag.cvPenalty*100).toFixed(0)}%`);
  }
}

(async () => {
  console.log('🧪 Quick Penalty Test - Reduced Penalties (12% max)\n');
  await test('Flat 120 Sudbury House', 'Flat 120 Sudbury House', 'SW18 4TT', 'flat', 261000, 0.80, 0.90);
  await test('Flat 75 Princess Court', 'Flat 75 Princess Court', 'M15 4FF', 'flat', 149000, 0.90, 0.97);
  await test('27 Woodlands', '27', 'NE3 4YN', 'house', 588000, 0.85, 0.95);
  console.log('\n✅ Test complete!');
})().catch(console.error);

import * as http from 'http';
import * as crypto from 'crypto';

const BASE_URL = 'http://localhost:3000';
const HMAC_SECRET = 'test-secret-key';

function generateHmac(data: object): string {
  return crypto.createHmac('sha256', JSON.stringify(data)).update(JSON.stringify(data)).digest('hex');
}

async function makeRequest(url: string, method: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const httpModule = parsedUrl.protocol === 'https:' ? https : http;
    const bodyString = body ? JSON.stringify(body) : '';
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname,
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
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (bodyString) req.write(bodyString);
    req.end();
  });
}

async function resolveAddress(postcode: string, houseNumber: string) {
  const result = await makeRequest(`${BASE_URL}/api/address/resolve`, 'POST', { postcode, houseNumber });
  return result.id ? { success: true, addressId: result.id } : { success: false, error: result.error || 'No ID' };
}

async function getValuation(addressId: string, addressLine1: string, postcode: string, propertyType: string) {
  const data = { addressId, addressLine1, postcode, propertyType, saleTimeline: '8-16_weeks', reasonForSelling: 'Test', source: 'test', consent: true };
  const body = { ...data, hmac: generateHmac(data) };
  return await makeRequest(`${BASE_URL}/api/valuation`, 'POST', body);
}

async function test(name: string, houseNumber: string, postcode: string, type: string, zoopla: number, targetMin: number, targetMax: number) {
  console.log(`\nTesting: ${name}`);
  const addr = await resolveAddress(postcode, houseNumber);
  if (!addr.success) { console.log(`  ❌ Address failed: ${addr.error}`); return; }
  
  const val = await getValuation(addr.addressId!, houseNumber, postcode, type);
  if (val.error) { console.log(`  ❌ Error: ${val.error}`); return; }
  if (val.deskReview) { console.log(`  ⚠️  Desk: ${val.deskReviewReason}`); return; }
  
  const cons = val.conservativeMarketValue?.central;
  const diag = val.conservativeDiagnostics;
  const ratio = cons / zoopla;
  const inTarget = ratio >= targetMin && ratio <= targetMax;
  
  console.log(`  Conservative: £${cons.toLocaleString()}`);
  console.log(`  Ratio: ${ratio.toFixed(2)} (target ${targetMin}-${targetMax}) ${inTarget ? '✅' : '❌'}`);
  if (diag) {
    console.log(`  Penalties: Block ${(diag.blockPenalty*100).toFixed(0)}%, Small ${(diag.smallUnitPenalty*100).toFixed(0)}%, Conf ${(diag.confidencePenalty*100).toFixed(0)}%, CV ${(diag.cvPenalty*100).toFixed(0)}%`);
  }
}

(async () => {
  console.log('🧪 Quick Penalty Test - Reduced Penalties (12% max)\n');
  await test('Flat 120 Sudbury House', 'Flat 120 Sudbury House', 'SW18 4TT', 'flat', 261000, 0.80, 0.90);
  await test('Flat 75 Princess Court', 'Flat 75 Princess Court', 'M15 4FF', 'flat', 149000, 0.90, 0.97);
  await test('27 Woodlands', '27', 'NE3 4YN', 'house', 588000, 0.85, 0.95);
  console.log('\n✅ Test complete!');
})().catch(console.error);

import * as http from 'http';
import * as crypto from 'crypto';

const BASE_URL = 'http://localhost:3000';
const HMAC_SECRET = 'test-secret-key';

function generateHmac(data: object): string {
  return crypto.createHmac('sha256', JSON.stringify(data)).update(JSON.stringify(data)).digest('hex');
}

async function makeRequest(url: string, method: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const httpModule = parsedUrl.protocol === 'https:' ? https : http;
    const bodyString = body ? JSON.stringify(body) : '';
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname,
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
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (bodyString) req.write(bodyString);
    req.end();
  });
}

async function resolveAddress(postcode: string, houseNumber: string) {
  const result = await makeRequest(`${BASE_URL}/api/address/resolve`, 'POST', { postcode, houseNumber });
  return result.id ? { success: true, addressId: result.id } : { success: false, error: result.error || 'No ID' };
}

async function getValuation(addressId: string, addressLine1: string, postcode: string, propertyType: string) {
  const data = { addressId, addressLine1, postcode, propertyType, saleTimeline: '8-16_weeks', reasonForSelling: 'Test', source: 'test', consent: true };
  const body = { ...data, hmac: generateHmac(data) };
  return await makeRequest(`${BASE_URL}/api/valuation`, 'POST', body);
}

async function test(name: string, houseNumber: string, postcode: string, type: string, zoopla: number, targetMin: number, targetMax: number) {
  console.log(`\nTesting: ${name}`);
  const addr = await resolveAddress(postcode, houseNumber);
  if (!addr.success) { console.log(`  ❌ Address failed: ${addr.error}`); return; }
  
  const val = await getValuation(addr.addressId!, houseNumber, postcode, type);
  if (val.error) { console.log(`  ❌ Error: ${val.error}`); return; }
  if (val.deskReview) { console.log(`  ⚠️  Desk: ${val.deskReviewReason}`); return; }
  
  const cons = val.conservativeMarketValue?.central;
  const diag = val.conservativeDiagnostics;
  const ratio = cons / zoopla;
  const inTarget = ratio >= targetMin && ratio <= targetMax;
  
  console.log(`  Conservative: £${cons.toLocaleString()}`);
  console.log(`  Ratio: ${ratio.toFixed(2)} (target ${targetMin}-${targetMax}) ${inTarget ? '✅' : '❌'}`);
  if (diag) {
    console.log(`  Penalties: Block ${(diag.blockPenalty*100).toFixed(0)}%, Small ${(diag.smallUnitPenalty*100).toFixed(0)}%, Conf ${(diag.confidencePenalty*100).toFixed(0)}%, CV ${(diag.cvPenalty*100).toFixed(0)}%`);
  }
}

(async () => {
  console.log('🧪 Quick Penalty Test - Reduced Penalties (12% max)\n');
  await test('Flat 120 Sudbury House', 'Flat 120 Sudbury House', 'SW18 4TT', 'flat', 261000, 0.80, 0.90);
  await test('Flat 75 Princess Court', 'Flat 75 Princess Court', 'M15 4FF', 'flat', 149000, 0.90, 0.97);
  await test('27 Woodlands', '27', 'NE3 4YN', 'house', 588000, 0.85, 0.95);
  console.log('\n✅ Test complete!');
})().catch(console.error);

import * as http from 'http';
import * as crypto from 'crypto';

const BASE_URL = 'http://localhost:3000';
const HMAC_SECRET = 'test-secret-key';

function generateHmac(data: object): string {
  return crypto.createHmac('sha256', JSON.stringify(data)).update(JSON.stringify(data)).digest('hex');
}

async function makeRequest(url: string, method: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const httpModule = parsedUrl.protocol === 'https:' ? https : http;
    const bodyString = body ? JSON.stringify(body) : '';
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname,
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
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (bodyString) req.write(bodyString);
    req.end();
  });
}

async function resolveAddress(postcode: string, houseNumber: string) {
  const result = await makeRequest(`${BASE_URL}/api/address/resolve`, 'POST', { postcode, houseNumber });
  return result.id ? { success: true, addressId: result.id } : { success: false, error: result.error || 'No ID' };
}

async function getValuation(addressId: string, addressLine1: string, postcode: string, propertyType: string) {
  const data = { addressId, addressLine1, postcode, propertyType, saleTimeline: '8-16_weeks', reasonForSelling: 'Test', source: 'test', consent: true };
  const body = { ...data, hmac: generateHmac(data) };
  return await makeRequest(`${BASE_URL}/api/valuation`, 'POST', body);
}

async function test(name: string, houseNumber: string, postcode: string, type: string, zoopla: number, targetMin: number, targetMax: number) {
  console.log(`\nTesting: ${name}`);
  const addr = await resolveAddress(postcode, houseNumber);
  if (!addr.success) { console.log(`  ❌ Address failed: ${addr.error}`); return; }
  
  const val = await getValuation(addr.addressId!, houseNumber, postcode, type);
  if (val.error) { console.log(`  ❌ Error: ${val.error}`); return; }
  if (val.deskReview) { console.log(`  ⚠️  Desk: ${val.deskReviewReason}`); return; }
  
  const cons = val.conservativeMarketValue?.central;
  const diag = val.conservativeDiagnostics;
  const ratio = cons / zoopla;
  const inTarget = ratio >= targetMin && ratio <= targetMax;
  
  console.log(`  Conservative: £${cons.toLocaleString()}`);
  console.log(`  Ratio: ${ratio.toFixed(2)} (target ${targetMin}-${targetMax}) ${inTarget ? '✅' : '❌'}`);
  if (diag) {
    console.log(`  Penalties: Block ${(diag.blockPenalty*100).toFixed(0)}%, Small ${(diag.smallUnitPenalty*100).toFixed(0)}%, Conf ${(diag.confidencePenalty*100).toFixed(0)}%, CV ${(diag.cvPenalty*100).toFixed(0)}%`);
  }
}

(async () => {
  console.log('🧪 Quick Penalty Test - Reduced Penalties (12% max)\n');
  await test('Flat 120 Sudbury House', 'Flat 120 Sudbury House', 'SW18 4TT', 'flat', 261000, 0.80, 0.90);
  await test('Flat 75 Princess Court', 'Flat 75 Princess Court', 'M15 4FF', 'flat', 149000, 0.90, 0.97);
  await test('27 Woodlands', '27', 'NE3 4YN', 'house', 588000, 0.85, 0.95);
  console.log('\n✅ Test complete!');
})().catch(console.error);

import * as http from 'http';
import * as crypto from 'crypto';

const BASE_URL = 'http://localhost:3000';
const HMAC_SECRET = 'test-secret-key';

function generateHmac(data: object): string {
  return crypto.createHmac('sha256', JSON.stringify(data)).update(JSON.stringify(data)).digest('hex');
}

async function makeRequest(url: string, method: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const httpModule = parsedUrl.protocol === 'https:' ? https : http;
    const bodyString = body ? JSON.stringify(body) : '';
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname,
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
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (bodyString) req.write(bodyString);
    req.end();
  });
}

async function resolveAddress(postcode: string, houseNumber: string) {
  const result = await makeRequest(`${BASE_URL}/api/address/resolve`, 'POST', { postcode, houseNumber });
  return result.id ? { success: true, addressId: result.id } : { success: false, error: result.error || 'No ID' };
}

async function getValuation(addressId: string, addressLine1: string, postcode: string, propertyType: string) {
  const data = { addressId, addressLine1, postcode, propertyType, saleTimeline: '8-16_weeks', reasonForSelling: 'Test', source: 'test', consent: true };
  const body = { ...data, hmac: generateHmac(data) };
  return await makeRequest(`${BASE_URL}/api/valuation`, 'POST', body);
}

async function test(name: string, houseNumber: string, postcode: string, type: string, zoopla: number, targetMin: number, targetMax: number) {
  console.log(`\nTesting: ${name}`);
  const addr = await resolveAddress(postcode, houseNumber);
  if (!addr.success) { console.log(`  ❌ Address failed: ${addr.error}`); return; }
  
  const val = await getValuation(addr.addressId!, houseNumber, postcode, type);
  if (val.error) { console.log(`  ❌ Error: ${val.error}`); return; }
  if (val.deskReview) { console.log(`  ⚠️  Desk: ${val.deskReviewReason}`); return; }
  
  const cons = val.conservativeMarketValue?.central;
  const diag = val.conservativeDiagnostics;
  const ratio = cons / zoopla;
  const inTarget = ratio >= targetMin && ratio <= targetMax;
  
  console.log(`  Conservative: £${cons.toLocaleString()}`);
  console.log(`  Ratio: ${ratio.toFixed(2)} (target ${targetMin}-${targetMax}) ${inTarget ? '✅' : '❌'}`);
  if (diag) {
    console.log(`  Penalties: Block ${(diag.blockPenalty*100).toFixed(0)}%, Small ${(diag.smallUnitPenalty*100).toFixed(0)}%, Conf ${(diag.confidencePenalty*100).toFixed(0)}%, CV ${(diag.cvPenalty*100).toFixed(0)}%`);
  }
}

(async () => {
  console.log('🧪 Quick Penalty Test - Reduced Penalties (12% max)\n');
  await test('Flat 120 Sudbury House', 'Flat 120 Sudbury House', 'SW18 4TT', 'flat', 261000, 0.80, 0.90);
  await test('Flat 75 Princess Court', 'Flat 75 Princess Court', 'M15 4FF', 'flat', 149000, 0.90, 0.97);
  await test('27 Woodlands', '27', 'NE3 4YN', 'house', 588000, 0.85, 0.95);
  console.log('\n✅ Test complete!');
})().catch(console.error);

import * as http from 'http';
import * as crypto from 'crypto';

const BASE_URL = 'http://localhost:3000';
const HMAC_SECRET = 'test-secret-key';

function generateHmac(data: object): string {
  return crypto.createHmac('sha256', JSON.stringify(data)).update(JSON.stringify(data)).digest('hex');
}

async function makeRequest(url: string, method: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const httpModule = parsedUrl.protocol === 'https:' ? https : http;
    const bodyString = body ? JSON.stringify(body) : '';
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname,
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
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (bodyString) req.write(bodyString);
    req.end();
  });
}

async function resolveAddress(postcode: string, houseNumber: string) {
  const result = await makeRequest(`${BASE_URL}/api/address/resolve`, 'POST', { postcode, houseNumber });
  return result.id ? { success: true, addressId: result.id } : { success: false, error: result.error || 'No ID' };
}

async function getValuation(addressId: string, addressLine1: string, postcode: string, propertyType: string) {
  const data = { addressId, addressLine1, postcode, propertyType, saleTimeline: '8-16_weeks', reasonForSelling: 'Test', source: 'test', consent: true };
  const body = { ...data, hmac: generateHmac(data) };
  return await makeRequest(`${BASE_URL}/api/valuation`, 'POST', body);
}

async function test(name: string, houseNumber: string, postcode: string, type: string, zoopla: number, targetMin: number, targetMax: number) {
  console.log(`\nTesting: ${name}`);
  const addr = await resolveAddress(postcode, houseNumber);
  if (!addr.success) { console.log(`  ❌ Address failed: ${addr.error}`); return; }
  
  const val = await getValuation(addr.addressId!, houseNumber, postcode, type);
  if (val.error) { console.log(`  ❌ Error: ${val.error}`); return; }
  if (val.deskReview) { console.log(`  ⚠️  Desk: ${val.deskReviewReason}`); return; }
  
  const cons = val.conservativeMarketValue?.central;
  const diag = val.conservativeDiagnostics;
  const ratio = cons / zoopla;
  const inTarget = ratio >= targetMin && ratio <= targetMax;
  
  console.log(`  Conservative: £${cons.toLocaleString()}`);
  console.log(`  Ratio: ${ratio.toFixed(2)} (target ${targetMin}-${targetMax}) ${inTarget ? '✅' : '❌'}`);
  if (diag) {
    console.log(`  Penalties: Block ${(diag.blockPenalty*100).toFixed(0)}%, Small ${(diag.smallUnitPenalty*100).toFixed(0)}%, Conf ${(diag.confidencePenalty*100).toFixed(0)}%, CV ${(diag.cvPenalty*100).toFixed(0)}%`);
  }
}

(async () => {
  console.log('🧪 Quick Penalty Test - Reduced Penalties (12% max)\n');
  await test('Flat 120 Sudbury House', 'Flat 120 Sudbury House', 'SW18 4TT', 'flat', 261000, 0.80, 0.90);
  await test('Flat 75 Princess Court', 'Flat 75 Princess Court', 'M15 4FF', 'flat', 149000, 0.90, 0.97);
  await test('27 Woodlands', '27', 'NE3 4YN', 'house', 588000, 0.85, 0.95);
  console.log('\n✅ Test complete!');
})().catch(console.error);

import * as http from 'http';
import * as crypto from 'crypto';

const BASE_URL = 'http://localhost:3000';
const HMAC_SECRET = 'test-secret-key';

function generateHmac(data: object): string {
  return crypto.createHmac('sha256', JSON.stringify(data)).update(JSON.stringify(data)).digest('hex');
}

async function makeRequest(url: string, method: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const httpModule = parsedUrl.protocol === 'https:' ? https : http;
    const bodyString = body ? JSON.stringify(body) : '';
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname,
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
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (bodyString) req.write(bodyString);
    req.end();
  });
}

async function resolveAddress(postcode: string, houseNumber: string) {
  const result = await makeRequest(`${BASE_URL}/api/address/resolve`, 'POST', { postcode, houseNumber });
  return result.id ? { success: true, addressId: result.id } : { success: false, error: result.error || 'No ID' };
}

async function getValuation(addressId: string, addressLine1: string, postcode: string, propertyType: string) {
  const data = { addressId, addressLine1, postcode, propertyType, saleTimeline: '8-16_weeks', reasonForSelling: 'Test', source: 'test', consent: true };
  const body = { ...data, hmac: generateHmac(data) };
  return await makeRequest(`${BASE_URL}/api/valuation`, 'POST', body);
}

async function test(name: string, houseNumber: string, postcode: string, type: string, zoopla: number, targetMin: number, targetMax: number) {
  console.log(`\nTesting: ${name}`);
  const addr = await resolveAddress(postcode, houseNumber);
  if (!addr.success) { console.log(`  ❌ Address failed: ${addr.error}`); return; }
  
  const val = await getValuation(addr.addressId!, houseNumber, postcode, type);
  if (val.error) { console.log(`  ❌ Error: ${val.error}`); return; }
  if (val.deskReview) { console.log(`  ⚠️  Desk: ${val.deskReviewReason}`); return; }
  
  const cons = val.conservativeMarketValue?.central;
  const diag = val.conservativeDiagnostics;
  const ratio = cons / zoopla;
  const inTarget = ratio >= targetMin && ratio <= targetMax;
  
  console.log(`  Conservative: £${cons.toLocaleString()}`);
  console.log(`  Ratio: ${ratio.toFixed(2)} (target ${targetMin}-${targetMax}) ${inTarget ? '✅' : '❌'}`);
  if (diag) {
    console.log(`  Penalties: Block ${(diag.blockPenalty*100).toFixed(0)}%, Small ${(diag.smallUnitPenalty*100).toFixed(0)}%, Conf ${(diag.confidencePenalty*100).toFixed(0)}%, CV ${(diag.cvPenalty*100).toFixed(0)}%`);
  }
}

(async () => {
  console.log('🧪 Quick Penalty Test - Reduced Penalties (12% max)\n');
  await test('Flat 120 Sudbury House', 'Flat 120 Sudbury House', 'SW18 4TT', 'flat', 261000, 0.80, 0.90);
  await test('Flat 75 Princess Court', 'Flat 75 Princess Court', 'M15 4FF', 'flat', 149000, 0.90, 0.97);
  await test('27 Woodlands', '27', 'NE3 4YN', 'house', 588000, 0.85, 0.95);
  console.log('\n✅ Test complete!');
})().catch(console.error);










