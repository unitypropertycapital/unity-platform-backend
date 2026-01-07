/**
 * Comprehensive Calibration Test Runner
 * Runs valuations on all addresses from calibration CSV and outputs updated results
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const HMAC_SECRET = process.env.HMAC_SECRET || 'test-secret-key';
const INPUT_CSV = path.join(__dirname, '../docs/calibration-results-rev2.csv');
const OUTPUT_CSV = path.join(__dirname, '../docs/calibration-results-rev2.csv');

interface CalibrationRow {
  row: string;
  address: string;
  postcode: string;
  townCity: string;
  propertyType: string;
  category: string;
  blockNotes: string;
  floorAreaSqm: string;
  zooplaLow: string;
  zooplaCentral: string;
  zooplaHigh: string;
  moovRawCentral: string;
  moovConservativeCentral: string;
  targetRatioMin: string;
  targetRatioMax: string;
  moovZooplaRatio: string;
  percentDiff: string;
  rowStatus: string;
  basePsqm: string;
  p25Psqm: string;
  medianPsqm: string;
  blockPenalty: string;
  smallUnitPenalty: string;
  confidencePenalty: string;
  cvPenalty: string;
  confidenceScore: string;
  cv: string;
  isExLocalAuthority: string;
  exLAScore: string;
  comment: string;
}

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

async function resolveAddress(postcode: string, houseNumber: string): Promise<{ success: boolean; addressId?: string; error?: string }> {
  const url = `${BASE_URL}/api/address/resolve`;
  const body = { postcode, houseNumber };
  
  try {
    const result = await makeRequest(url, 'POST', body);
    if (result.error) {
      return { success: false, error: result.error };
    }
    if (result.id) {
      return { success: true, addressId: result.id };
    }
    return { success: false, error: 'No address ID returned' };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function getValuation(addressId: string, addressLine1: string, postcode: string, propertyType: string): Promise<any> {
  const url = `${BASE_URL}/api/valuation`;
  
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
  
  const hmac = generateHmac(requestData);
  const body = { ...requestData, hmac };
  
  return makeRequest(url, 'POST', body);
}

function parseCSV(content: string): CalibrationRow[] {
  const lines = content.split('\n');
  const rows: CalibrationRow[] = [];
  
  for (let i = 1; i < lines.length; i++) { // Skip header
    const line = lines[i].trim();
    if (!line) continue;
    
    // Handle CSV with quoted fields
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current);
    
    if (fields.length >= 30) {
      rows.push({
        row: fields[0],
        address: fields[1],
        postcode: fields[2],
        townCity: fields[3],
        propertyType: fields[4],
        category: fields[5],
        blockNotes: fields[6],
        floorAreaSqm: fields[7],
        zooplaLow: fields[8],
        zooplaCentral: fields[9],
        zooplaHigh: fields[10],
        moovRawCentral: fields[11],
        moovConservativeCentral: fields[12],
        targetRatioMin: fields[13],
        targetRatioMax: fields[14],
        moovZooplaRatio: fields[15],
        percentDiff: fields[16],
        rowStatus: fields[17],
        basePsqm: fields[18],
        p25Psqm: fields[19],
        medianPsqm: fields[20],
        blockPenalty: fields[21],
        smallUnitPenalty: fields[22],
        confidencePenalty: fields[23],
        cvPenalty: fields[24],
        confidenceScore: fields[25],
        cv: fields[26],
        isExLocalAuthority: fields[27],
        exLAScore: fields[28],
        comment: fields[29] || '',
      });
    }
  }
  
  return rows;
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function testAddress(row: CalibrationRow): Promise<CalibrationRow> {
  console.log(`\n[${ row.row}] Testing: ${row.address}, ${row.postcode}`);
  
  // Extract house number from address (first word/number)
  const addressParts = row.address.split(',')[0].trim();
  const houseNumber = addressParts;
  
  try {
    // Step 1: Resolve address
    const addressResult = await resolveAddress(row.postcode, houseNumber);
    
    if (!addressResult.success) {
      row.moovRawCentral = 'ADDR_FAIL';
      row.moovConservativeCentral = '';
      row.rowStatus = 'ADDR_FAIL';
      row.comment = `Address not found: ${addressResult.error}`;
      console.log(`  ❌ Address resolution failed: ${addressResult.error}`);
      return row;
    }
    
    // Step 2: Get valuation
    const propertyType = row.propertyType.toLowerCase();
    const result = await getValuation(addressResult.addressId!, houseNumber, row.postcode, propertyType);
    
    if (result.error) {
      row.moovRawCentral = 'ERROR';
      row.moovConservativeCentral = '';
      row.rowStatus = 'ERROR';
      row.comment = `Error: ${result.error}`;
      console.log(`  ❌ Valuation error: ${result.error}`);
      return row;
    }
    
    if (result.deskReview) {
      row.moovRawCentral = 'DESK_REV';
      row.moovConservativeCentral = '';
      row.rowStatus = 'DESK';
      row.comment = result.deskReviewReason || 'Desk review required';
      console.log(`  ⚠️  Desk review: ${row.comment}`);
      return row;
    }
    
    // Success - extract values
    row.moovRawCentral = result.marketValue?.central || '';
    row.moovConservativeCentral = result.conservativeMarketValue?.central || '';
    
    // Calculate ratio if we have Zoopla value
    const zooplaCentral = parseFloat(row.zooplaCentral);
    const moovConservative = parseFloat(row.moovConservativeCentral);
    
    if (!isNaN(zooplaCentral) && zooplaCentral > 0 && !isNaN(moovConservative)) {
      const ratio = moovConservative / zooplaCentral;
      row.moovZooplaRatio = ratio.toFixed(2);
      row.percentDiff = `${((ratio - 1) * 100).toFixed(0)}%`;
      
      const targetMin = parseFloat(row.targetRatioMin);
      const targetMax = parseFloat(row.targetRatioMax);
      
      if (!isNaN(targetMin) && !isNaN(targetMax)) {
        if (ratio >= targetMin && ratio <= targetMax) {
          row.rowStatus = 'PASS';
        } else {
          row.rowStatus = 'CHECK';
        }
      }
    }
    
    // Extract diagnostics
    const diag = result.conservativeDiagnostics;
    if (diag) {
      row.basePsqm = diag.basePsqm || '';
      row.p25Psqm = diag.p25Psqm || '';
      row.medianPsqm = diag.medianPsqm || '';
      row.blockPenalty = diag.blockPenalty ? `${(diag.blockPenalty * 100).toFixed(1)}%` : '';
      row.smallUnitPenalty = diag.smallUnitPenalty ? `${(diag.smallUnitPenalty * 100).toFixed(1)}%` : '';
      row.confidencePenalty = diag.confidencePenalty ? `${(diag.confidencePenalty * 100).toFixed(1)}%` : '';
      row.cvPenalty = diag.cvPenalty ? `${(diag.cvPenalty * 100).toFixed(1)}%` : '';
      row.isExLocalAuthority = diag.isExLocalAuthority ? 'TRUE' : 'FALSE';
      row.exLAScore = diag.exLAScore || '';
    }
    
    if (result.confidence) {
      row.confidenceScore = result.confidence.score || '';
    }
    
    // Calculate CV from comparables stats
    if (result.comparables?.stats) {
      const stats = result.comparables.stats;
      if (stats.stdDevPricePerSqm && stats.meanPricePerSqm) {
        const cv = stats.stdDevPricePerSqm / stats.meanPricePerSqm;
        row.cv = cv.toFixed(2);
      }
    }
    
    console.log(`  ✅ Success: Conservative £${row.moovConservativeCentral}, Ratio ${row.moovZooplaRatio}`);
    
  } catch (error: any) {
    row.moovRawCentral = 'ERROR';
    row.moovConservativeCentral = '';
    row.rowStatus = 'ERROR';
    row.comment = `Exception: ${error.message}`;
    console.log(`  ❌ Exception: ${error.message}`);
  }
  
  return row;
}

async function main() {
  console.log('🏠 COMPREHENSIVE CALIBRATION TEST');
  console.log(`API: ${BASE_URL}`);
  console.log(`Input: ${INPUT_CSV}`);
  console.log(`Output: ${OUTPUT_CSV}\n`);
  
  // Read input CSV
  const csvContent = fs.readFileSync(INPUT_CSV, 'utf-8');
  const rows = parseCSV(csvContent);
  
  console.log(`Loaded ${rows.length} test cases\n`);
  console.log('Starting tests...');
  
  const startTime = Date.now();
  const updatedRows: CalibrationRow[] = [];
  
  for (const row of rows) {
    const updatedRow = await testAddress(row);
    updatedRows.push(updatedRow);
    
    // Small delay to avoid overwhelming the API
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  
  // Write output CSV
  const header = 'Row,Address,Postcode,Town/City,Property Type,Category,Block / Notes,Floor Area Sqm (EPC),Zoopla Low,Zoopla Central,Zoopla High,Moov Raw Central,Moov Conservative Central,Target Ratio Min,Target Ratio Max,Moov/Zoopla Central Ratio,% Diff vs Zoopla,Row Status,Base £/sqm,P25 £/sqm,Median £/sqm,Block Penalty,Small Unit Penalty,Confidence Penalty,CV Penalty,Confidence Score,Coefficient of Variation (CV),isExLocalAuthority,exLAScore,Comment';
  
  const csvLines = [header];
  for (const row of updatedRows) {
    const line = [
      row.row,
      escapeCSV(row.address),
      row.postcode,
      row.townCity,
      row.propertyType,
      row.category,
      escapeCSV(row.blockNotes),
      row.floorAreaSqm,
      row.zooplaLow,
      row.zooplaCentral,
      row.zooplaHigh,
      row.moovRawCentral,
      row.moovConservativeCentral,
      row.targetRatioMin,
      row.targetRatioMax,
      row.moovZooplaRatio,
      row.percentDiff,
      row.rowStatus,
      row.basePsqm,
      row.p25Psqm,
      row.medianPsqm,
      row.blockPenalty,
      row.smallUnitPenalty,
      row.confidencePenalty,
      row.cvPenalty,
      row.confidenceScore,
      row.cv,
      row.isExLocalAuthority,
      row.exLAScore,
      escapeCSV(row.comment),
    ].join(',');
    csvLines.push(line);
  }
  
  fs.writeFileSync(OUTPUT_CSV, csvLines.join('\n'));
  
  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('CALIBRATION TEST COMPLETE');
  console.log('='.repeat(80));
  console.log(`Duration: ${duration} minutes`);
  console.log(`Total: ${updatedRows.length}`);
  console.log(`Pass: ${updatedRows.filter(r => r.rowStatus === 'PASS').length}`);
  console.log(`Check: ${updatedRows.filter(r => r.rowStatus === 'CHECK').length}`);
  console.log(`Desk Review: ${updatedRows.filter(r => r.rowStatus === 'DESK').length}`);
  console.log(`Address Fail: ${updatedRows.filter(r => r.rowStatus === 'ADDR_FAIL').length}`);
  console.log(`Error: ${updatedRows.filter(r => r.rowStatus === 'ERROR').length}`);
  console.log(`\nResults written to: ${OUTPUT_CSV}`);
}

main().catch(console.error);

