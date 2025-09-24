#!/usr/bin/env node
import { config } from 'dotenv';
config();

console.log('GraphQL Debugging Script');
console.log('========================\n');

// Check environment
console.log('1. Environment Check:');
console.log('   GRAPH_ENDPOINT:', process.env.GRAPH_ENDPOINT);
console.log('   GRAPH_SINGLE_KEY:', process.env.GRAPH_SINGLE_KEY?.substring(0, 20) + '...');
console.log('   GRAPH_AUTH_METHOD:', process.env.GRAPH_AUTH_METHOD);

// Use the endpoint as configured
const endpoint = process.env.GRAPH_ENDPOINT;

console.log('   Using endpoint:', endpoint);

// Test 1: Direct fetch with single key
console.log('\n2. Testing with fetch (single key):');
try {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `epi-single ${process.env.GRAPH_SINGLE_KEY}`
    },
    body: JSON.stringify({
      query: '{ _Content(limit: 1) { items { _metadata { displayName } } } }'
    })
  });

  console.log('   Status:', response.status, response.statusText);
  console.log('   Headers:', Object.fromEntries(response.headers.entries()));
  
  const text = await response.text();
  if (response.status === 403) {
    console.log('   Response preview:', text.substring(0, 200) + '...');
    if (text.includes('Cloudflare')) {
      console.log('\n   ❌ BLOCKED BY CLOUDFLARE');
      console.log('   Your IP or the API key is being blocked.');
    }
  } else if (response.ok) {
    console.log('   ✅ SUCCESS! Response:', text);
  } else {
    console.log('   Response:', text);
  }
} catch (error) {
  console.log('   ❌ Network error:', error.message);
}

// Test 2: Try HMAC auth if available
if (process.env.GRAPH_APP_KEY && process.env.GRAPH_SECRET) {
  console.log('\n3. Testing with HMAC authentication:');
  
  try {
    // Create HMAC signature
    const crypto = await import('crypto');
    const method = 'POST';
    const path = new URL(endpoint).pathname;
    const body = JSON.stringify({
      query: '{ _Content(limit: 1) { items { _metadata { displayName } } } }'
    });
    const timestamp = new Date().toISOString();
    
    // Create string to sign
    const stringToSign = [
      method,
      path,
      timestamp,
      process.env.GRAPH_APP_KEY,
      crypto.createHash('sha256').update(body).digest('base64')
    ].join('\n');
    
    // Create signature
    const signature = crypto
      .createHmac('sha256', Buffer.from(process.env.GRAPH_SECRET, 'base64'))
      .update(stringToSign)
      .digest('base64');
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `epi-hmac ${process.env.GRAPH_APP_KEY}:${signature}`,
        'X-EPI-Timestamp': timestamp
      },
      body: body
    });

    console.log('   Status:', response.status, response.statusText);
    const text = await response.text();
    if (response.ok) {
      console.log('   ✅ HMAC AUTH WORKS! Response:', text);
    } else {
      console.log('   Response preview:', text.substring(0, 200) + '...');
    }
  } catch (error) {
    console.log('   ❌ Error:', error.message);
  }
}

// Test 3: Try different endpoints
console.log('\n4. Testing alternative endpoints:');
const alternativeEndpoints = [
  'https://cg.optimizely.com/content/v2',
  'https://cg.optimizely.com/api/content/v2',
  'https://graph.optimizely.com/content/v2'
];

for (const altEndpoint of alternativeEndpoints) {
  console.log(`\n   Trying: ${altEndpoint}`);
  try {
    const response = await fetch(altEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `epi-single ${process.env.GRAPH_SINGLE_KEY}`
      },
      body: JSON.stringify({
        query: '{ _Content(limit: 1) { items { _metadata { displayName } } } }'
      })
    });
    
    console.log(`   Status: ${response.status}`);
    if (response.status === 200) {
      console.log('   ✅ This endpoint works!');
      break;
    }
  } catch (error) {
    console.log(`   Error: ${error.message}`);
  }
}

// Suggestions
console.log('\n5. Debugging Steps:');
console.log('   a) Verify your API key is correct (no extra spaces)');
console.log('   b) Try generating a new key from your Optimizely instance');
console.log('   c) Check if your instance URL has GraphQL enabled');
console.log('   d) Try using a VPN if Cloudflare is blocking your IP');
console.log('   e) Contact Optimizely support with the Cloudflare Ray ID');

console.log('\n6. To get a new API key:');
console.log('   1. Log into your Optimizely CMS');
console.log('   2. Go to Settings > GraphQL or similar section');
console.log('   3. Generate a new single key');
console.log('   4. Update GRAPH_SINGLE_KEY in your .env file');