#!/usr/bin/env node
import { config } from 'dotenv';
config();

console.log('Validating GraphQL Key');
console.log('=====================\n');

const key = process.env.GRAPH_SINGLE_KEY;

console.log('Key Analysis:');
console.log('- Length:', key.length, 'characters');
console.log('- First 10 chars:', key.substring(0, 10));
console.log('- Last 10 chars:', '...' + key.substring(key.length - 10));
console.log('- Contains spaces:', key.includes(' ') ? 'YES ⚠️' : 'NO ✓');
console.log('- Contains tabs:', key.includes('\t') ? 'YES ⚠️' : 'NO ✓');
console.log('- Contains newlines:', key.includes('\n') ? 'YES ⚠️' : 'NO ✓');

// Check key pattern
const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;
const isBase64Like = base64Pattern.test(key);
console.log('- Looks like base64:', isBase64Like ? 'YES' : 'NO');

// Typical Optimizely single key characteristics
console.log('\nTypical Optimizely Single Key Format:');
console.log('- Usually 40-60 characters long');
console.log('- Contains letters, numbers, no special chars except maybe = at end');
console.log('- No spaces or line breaks');

console.log('\nYour key appears to be:', key.length >= 40 && key.length <= 60 && !key.includes(' ') ? '✓ Valid format' : '⚠️  Possibly invalid format');

// Test with a simple Node.js request to see exact error
console.log('\nTesting direct HTTPS request...');
import https from 'https';

const postData = JSON.stringify({
  query: '{ _Content(limit: 1) { items { _metadata { displayName } } } }'
});

const options = {
  hostname: 'cg.optimizely.com',
  port: 443,
  path: '/content/v2',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData),
    'Authorization': `epi-single ${key}`,
    'User-Agent': 'optimizely-mcp-test/1.0'
  }
};

const req = https.request(options, (res) => {
  console.log('Status Code:', res.statusCode);
  console.log('Status Message:', res.statusMessage);
  console.log('Key Headers:');
  console.log('  CF-Ray:', res.headers['cf-ray']);
  console.log('  Server:', res.headers.server);
  
  if (res.statusCode === 403) {
    console.log('\n❌ Result: Key is invalid or blocked by Cloudflare');
    console.log('\nNext steps:');
    console.log('1. Log into your Optimizely CMS instance');
    console.log('2. Navigate to the GraphQL settings/configuration');
    console.log('3. Generate a NEW single key');
    console.log('4. Copy it carefully (no extra spaces)');
    console.log('5. Update your .env file');
    
    console.log('\nIf you don\'t have access to generate keys:');
    console.log('- Ask your Optimizely administrator');
    console.log('- Check if your instance has GraphQL enabled');
    console.log('- Verify you have the right permissions');
  }
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});

req.write(postData);
req.end();