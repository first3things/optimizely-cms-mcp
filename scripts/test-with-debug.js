#!/usr/bin/env node

import { config } from 'dotenv';
config();

// Force debug logging
process.env.LOG_LEVEL = 'debug';

console.log('='.repeat(60));
console.log('DETAILED API DEBUGGING');
console.log('='.repeat(60));
console.log('');

// Show configuration
console.log('CONFIGURATION:');
console.log('--------------');
console.log('GRAPH_ENDPOINT:', process.env.GRAPH_ENDPOINT);
console.log('GRAPH_AUTH_METHOD:', process.env.GRAPH_AUTH_METHOD);
console.log('GRAPH_SINGLE_KEY:', process.env.GRAPH_SINGLE_KEY ? `${process.env.GRAPH_SINGLE_KEY.substring(0, 20)}...` : 'NOT SET');
console.log('');

// Test GraphQL endpoint
console.log('TESTING GRAPHQL API:');
console.log('-------------------');

const endpoint = process.env.GRAPH_ENDPOINT || 'https://cg.optimizely.com/content/v2';
const query = {
  query: `{
    _Content(limit: 1) {
      items {
        _metadata {
          displayName
        }
      }
    }
  }`
};

console.log('Request URL:', endpoint);
console.log('Request Method: POST');
console.log('Request Headers:');
console.log('  Content-Type: application/json');
console.log('  Authorization: epi-single', process.env.GRAPH_SINGLE_KEY ? `${process.env.GRAPH_SINGLE_KEY.substring(0, 20)}...` : 'NOT SET');
console.log('Request Body:', JSON.stringify(query, null, 2));
console.log('');

try {
  console.log('Sending request...');
  const startTime = Date.now();
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `epi-single ${process.env.GRAPH_SINGLE_KEY}`,
      'User-Agent': 'optimizely-mcp-debug/1.0'
    },
    body: JSON.stringify(query)
  });

  const duration = Date.now() - startTime;
  
  console.log('\nRESPONSE DETAILS:');
  console.log('-----------------');
  console.log('Status:', response.status, response.statusText);
  console.log('Duration:', duration, 'ms');
  console.log('Response Headers:');
  for (const [key, value] of response.headers.entries()) {
    console.log(' ', key + ':', value);
  }
  
  const responseText = await response.text();
  console.log('\nResponse Body:');
  console.log('-'.repeat(40));
  
  if (response.headers.get('content-type')?.includes('application/json')) {
    try {
      const json = JSON.parse(responseText);
      console.log(JSON.stringify(json, null, 2));
    } catch (e) {
      console.log(responseText);
    }
  } else {
    // Show first 1000 chars if HTML
    console.log(responseText.substring(0, 1000));
    if (responseText.length > 1000) {
      console.log('\n... (truncated)');
    }
  }
  
  console.log('-'.repeat(40));
  
  // Analysis
  console.log('\nANALYSIS:');
  console.log('---------');
  
  if (response.status === 400) {
    console.log('❌ 400 Bad Request - The request is malformed');
    console.log('   Possible issues:');
    console.log('   - Invalid endpoint URL');
    console.log('   - Missing required headers');
    console.log('   - Invalid request body format');
  } else if (response.status === 401) {
    console.log('❌ 401 Unauthorized - Authentication failed');
    console.log('   Possible issues:');
    console.log('   - Invalid API key');
    console.log('   - Wrong authentication header format');
  } else if (response.status === 403) {
    console.log('❌ 403 Forbidden - Access denied');
    if (responseText.includes('Cloudflare')) {
      console.log('   - Blocked by Cloudflare WAF');
      console.log('   - Your IP or API key may be blocked');
    } else {
      console.log('   - API key lacks required permissions');
    }
  } else if (response.status === 404) {
    console.log('❌ 404 Not Found - Endpoint does not exist');
    console.log('   - Check if the endpoint URL is correct');
  } else if (response.status >= 200 && response.status < 300) {
    console.log('✅ Success!');
  } else {
    console.log('❌ Unexpected status code');
  }
  
} catch (error) {
  console.log('\nNETWORK ERROR:');
  console.log('--------------');
  console.log('Error Type:', error.constructor.name);
  console.log('Error Message:', error.message);
  console.log('Stack:', error.stack);
}

// Test CMA API
console.log('\n\n');
console.log('TESTING CONTENT MANAGEMENT API:');
console.log('-------------------------------');

const cmaBaseUrl = process.env.CMA_BASE_URL || 'https://api.cms.optimizely.com/preview3';
const tokenEndpoint = process.env.CMA_TOKEN_ENDPOINT || 'https://api.cms.optimizely.com/oauth/token';

console.log('Token Endpoint:', tokenEndpoint);
console.log('CMA Base URL:', cmaBaseUrl);
console.log('Client ID:', process.env.CMA_CLIENT_ID ? `${process.env.CMA_CLIENT_ID.substring(0, 20)}...` : 'NOT SET');
console.log('');

// Get OAuth token
try {
  console.log('Requesting OAuth token...');
  const tokenResponse = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.CMA_CLIENT_ID || '',
      client_secret: process.env.CMA_CLIENT_SECRET || '',
    })
  });

  console.log('Token Response Status:', tokenResponse.status);
  const tokenData = await tokenResponse.json();
  
  if (tokenResponse.ok && tokenData.access_token) {
    console.log('✅ OAuth token obtained successfully');
    
    // Test content types endpoint
    console.log('\nTesting content types endpoint...');
    const typesUrl = `${cmaBaseUrl}/contenttypes`;
    console.log('Request URL:', typesUrl);
    
    const typesResponse = await fetch(typesUrl, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Accept': 'application/json'
      }
    });
    
    console.log('Response Status:', typesResponse.status, typesResponse.statusText);
    const typesText = await typesResponse.text();
    console.log('Response Body:', typesText.substring(0, 500));
    
  } else {
    console.log('❌ Failed to get OAuth token');
    console.log('Response:', JSON.stringify(tokenData, null, 2));
  }
} catch (error) {
  console.log('❌ CMA Error:', error.message);
}

console.log('\n' + '='.repeat(60));
console.log('DEBUGGING COMPLETE');
console.log('='.repeat(60));