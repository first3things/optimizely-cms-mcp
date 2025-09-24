#!/usr/bin/env node
import { config } from 'dotenv';
import https from 'https';

config();

console.log('Finding Your GraphQL Endpoint');
console.log('=============================\n');

console.log('This script will help you find the correct GraphQL endpoint for your Optimizely instance.\n');

// Common patterns for Optimizely GraphQL endpoints
const endpointPatterns = [
  // Public Content Graph
  'https://cg.optimizely.com/content/v2/graphql',
  'https://cg.optimizely.com/api/content/v2/graphql',
  
  // Instance-specific patterns (replace [instance] with your instance name)
  'https://[instance].cms.optimizely.com/graphql',
  'https://[instance].cms.optimizely.com/api/graphql',
  'https://[instance].cms.optimizely.com/EPiServer/CMS/Admin/GraphQL',
  'https://[instance].optimizely.com/graphql',
  'https://[instance].optimizely.com/api/graphql',
  'https://[instance].episerver.net/graphql',
  
  // DXP patterns
  'https://[instance]-edit.dxcloud.episerver.net/graphql',
  'https://[instance].dxcloud.episerver.net/graphql'
];

console.log('Step 1: Find Your Instance Name');
console.log('-------------------------------');
console.log('When you log into Optimizely CMS, look at the URL:');
console.log('  https://[THIS-PART].cms.optimizely.com/...');
console.log('  The [THIS-PART] is your instance name\n');

console.log('Step 2: Common Endpoint Patterns');
console.log('--------------------------------');
endpointPatterns.forEach((pattern, i) => {
  console.log(`${i + 1}. ${pattern}`);
});

console.log('\nStep 3: Find GraphQL in Your CMS');
console.log('--------------------------------');
console.log('1. Log into your Optimizely CMS');
console.log('2. Look for these menu items:');
console.log('   - Admin > Config > GraphQL');
console.log('   - Settings > API > GraphQL');
console.log('   - Developer > GraphQL Explorer');
console.log('   - Tools > GraphQL');

console.log('\nStep 4: GraphQL Configuration Page');
console.log('----------------------------------');
console.log('On the GraphQL configuration page, you should find:');
console.log('1. GraphQL Endpoint URL');
console.log('2. Authentication Methods Available');
console.log('3. API Key Management');

console.log('\nStep 5: Generate API Keys');
console.log('-------------------------');
console.log('Single Key (Recommended for simplicity):');
console.log('1. Click "Generate Single Key" or "Create New Key"');
console.log('2. Give it a name (e.g., "MCP Server Key")');
console.log('3. Copy the ENTIRE key immediately');
console.log('4. Update GRAPH_SINGLE_KEY in .env');

console.log('\nHMAC Authentication (More secure):');
console.log('1. Click "Create Application" or "New App"');
console.log('2. Note down the App Key');
console.log('3. Copy the Secret (shown only once!)');
console.log('4. Update GRAPH_APP_KEY and GRAPH_SECRET in .env');

console.log('\nStep 6: Test Your Endpoint');
console.log('--------------------------');
console.log('Once you have your endpoint and key, test with curl:\n');

console.log('For Single Key:');
console.log(`curl -X POST https://YOUR-ENDPOINT/graphql \\
  -H "Authorization: epi-single YOUR-KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "{ _Content(limit: 1) { items { _metadata { displayName } } } }"}'`);

console.log('\n\nTroubleshooting');
console.log('===============');

console.log('\n❌ "Page not found" when looking for GraphQL?');
console.log('   - GraphQL might not be enabled for your instance');
console.log('   - You might not have admin permissions');
console.log('   - Your Optimizely version might not support GraphQL');

console.log('\n❌ "Invalid key" errors?');
console.log('   - Key might have extra spaces or newlines');
console.log('   - Key might be expired');
console.log('   - Wrong authentication method selected');

console.log('\n❌ Still blocked by Cloudflare?');
console.log('   - Your instance might use a different endpoint');
console.log('   - Try the instance-specific URL instead of cg.optimizely.com');
console.log('   - Contact Optimizely support');

console.log('\n\nExample Working Configuration');
console.log('=============================');
console.log(`
# For public Content Graph
GRAPH_ENDPOINT=https://cg.optimizely.com/content/v2/graphql
GRAPH_AUTH_METHOD=single_key
GRAPH_SINGLE_KEY=your-valid-key-from-optimizely

# For instance-specific endpoint
GRAPH_ENDPOINT=https://mycompany.cms.optimizely.com/graphql
GRAPH_AUTH_METHOD=bearer
GRAPH_TOKEN=your-bearer-token
`);

// Quick test if credentials are configured
if (process.env.GRAPH_SINGLE_KEY || process.env.GRAPH_APP_KEY) {
  console.log('\n\nTesting Your Current Configuration');
  console.log('==================================');
  
  const endpoint = process.env.GRAPH_ENDPOINT?.includes('/graphql') 
    ? process.env.GRAPH_ENDPOINT 
    : `${process.env.GRAPH_ENDPOINT}/content/v2/graphql`;
    
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Auth Method: ${process.env.GRAPH_AUTH_METHOD}`);
  
  console.log('\nRun this command to test:');
  console.log('npm run debug:graph');
}