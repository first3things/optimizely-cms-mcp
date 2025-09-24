#!/usr/bin/env node
import { config } from 'dotenv';
import https from 'https';
import crypto from 'crypto';

config();

console.log('Comprehensive Authentication Debugging');
console.log('=====================================\n');

// Test configurations
const tests = [];

// Test 1: Single Key Authentication
if (process.env.GRAPH_SINGLE_KEY) {
  tests.push({
    name: 'Single Key Authentication',
    endpoint: process.env.GRAPH_ENDPOINT || 'https://cg.optimizely.com/content/v2',
    headers: {
      'Authorization': `epi-single ${process.env.GRAPH_SINGLE_KEY}`
    }
  });
}

// Test 2: HMAC Authentication
if (process.env.GRAPH_APP_KEY && process.env.GRAPH_SECRET) {
  const method = 'POST';
  const path = '/content/v2';
  const body = JSON.stringify({
    query: '{ _Content(limit: 1) { items { _metadata { displayName } } } }'
  });
  const timestamp = new Date().toISOString();
  
  const stringToSign = [
    method,
    path,
    timestamp,
    process.env.GRAPH_APP_KEY,
    crypto.createHash('sha256').update(body).digest('base64')
  ].join('\n');
  
  const signature = crypto
    .createHmac('sha256', Buffer.from(process.env.GRAPH_SECRET, 'base64'))
    .update(stringToSign)
    .digest('base64');
  
  tests.push({
    name: 'HMAC Authentication',
    endpoint: process.env.GRAPH_ENDPOINT || 'https://cg.optimizely.com/content/v2',
    headers: {
      'Authorization': `epi-hmac ${process.env.GRAPH_APP_KEY}:${signature}`,
      'X-EPI-Timestamp': timestamp
    }
  });
}

// Test 3: Bearer Token (if available)
if (process.env.GRAPH_TOKEN) {
  tests.push({
    name: 'Bearer Token Authentication',
    endpoint: process.env.GRAPH_ENDPOINT || 'https://cg.optimizely.com/content/v2',
    headers: {
      'Authorization': `Bearer ${process.env.GRAPH_TOKEN}`
    }
  });
}

// Test 4: Basic Auth (if available)
if (process.env.GRAPH_USERNAME && process.env.GRAPH_PASSWORD) {
  const credentials = Buffer.from(`${process.env.GRAPH_USERNAME}:${process.env.GRAPH_PASSWORD}`).toString('base64');
  tests.push({
    name: 'Basic Authentication',
    endpoint: process.env.GRAPH_ENDPOINT || 'https://cg.optimizely.com/content/v2',
    headers: {
      'Authorization': `Basic ${credentials}`
    }
  });
}

// Function to test each configuration
async function testAuth(config) {
  return new Promise((resolve) => {
    console.log(`\nTesting: ${config.name}`);
    console.log('-'.repeat(40));
    
    const postData = JSON.stringify({
      query: '{ _Content(limit: 1) { items { _metadata { displayName } } } }'
    });
    
    const url = new URL(config.endpoint);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'optimizely-mcp-debug/1.0',
        ...config.headers
      }
    };
    
    console.log('Request details:');
    console.log(`  URL: ${config.endpoint}`);
    console.log(`  Auth header: ${config.headers.Authorization.substring(0, 30)}...`);
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log(`\nResponse Status: ${res.statusCode} ${res.statusMessage}`);
        
        // Log important headers
        if (res.headers['cf-ray']) {
          console.log(`CF-Ray: ${res.headers['cf-ray']}`);
        }
        if (res.headers['x-request-id']) {
          console.log(`Request ID: ${res.headers['x-request-id']}`);
        }
        
        // Analyze response
        if (res.statusCode === 200) {
          console.log('✅ SUCCESS! Authentication worked');
          try {
            const json = JSON.parse(data);
            console.log('Response preview:', JSON.stringify(json).substring(0, 200));
          } catch {
            console.log('Response:', data.substring(0, 200));
          }
        } else if (res.statusCode === 403) {
          console.log('❌ FORBIDDEN - Authentication failed');
          if (data.includes('Cloudflare')) {
            console.log('Blocked by Cloudflare - likely invalid credentials');
          } else {
            console.log('Response:', data.substring(0, 300));
          }
        } else if (res.statusCode === 401) {
          console.log('❌ UNAUTHORIZED - Invalid credentials');
          console.log('Response:', data.substring(0, 300));
        } else if (res.statusCode === 404) {
          console.log('❌ NOT FOUND - Wrong endpoint URL');
        } else {
          console.log('❌ Unexpected response');
          console.log('Response:', data.substring(0, 300));
        }
        
        resolve();
      });
    });
    
    req.on('error', (e) => {
      console.error('❌ Request error:', e.message);
      resolve();
    });
    
    req.write(postData);
    req.end();
  });
}

// Run all tests
async function runTests() {
  if (tests.length === 0) {
    console.log('❌ No authentication credentials found in .env');
    console.log('\nPlease configure at least one of:');
    console.log('  - GRAPH_SINGLE_KEY');
    console.log('  - GRAPH_APP_KEY + GRAPH_SECRET');
    console.log('  - GRAPH_TOKEN');
    console.log('  - GRAPH_USERNAME + GRAPH_PASSWORD');
    return;
  }
  
  for (const test of tests) {
    await testAuth(test);
  }
  
  console.log('\n\nDebugging Summary');
  console.log('=================');
  console.log('\nIf all tests failed with 403/Cloudflare:');
  console.log('1. Your credentials are invalid or expired');
  console.log('2. Log into your Optimizely CMS admin panel');
  console.log('3. Navigate to Settings > GraphQL or API Keys');
  console.log('4. Generate new credentials');
  console.log('5. Update your .env file');
  
  console.log('\nCommon GraphQL endpoints to try:');
  console.log('- https://cg.optimizely.com/content/v2/graphql (public)');
  console.log('- https://[instance].cms.optimizely.com/graphql (instance-specific)');
  console.log('- https://[instance].optimizely.com/api/graphql');
  
  console.log('\nIf you need help:');
  console.log('1. Check Optimizely documentation for your version');
  console.log('2. Contact your Optimizely administrator');
  console.log('3. Reach out to Optimizely support with the CF-Ray ID');
}

runTests();