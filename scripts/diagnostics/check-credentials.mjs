import { config } from 'dotenv';
config();

console.log('Credential Check');
console.log('================\n');

// Check GraphQL credentials
console.log('GraphQL Configuration:');
console.log('- Endpoint:', process.env.GRAPH_ENDPOINT);
console.log('- Auth Method:', process.env.GRAPH_AUTH_METHOD);
console.log('- Single Key:', process.env.GRAPH_SINGLE_KEY ? `${process.env.GRAPH_SINGLE_KEY.substring(0, 10)}...` : 'NOT SET');

// Test GraphQL with curl command
console.log('\nTo test GraphQL manually, run this command:');
console.log(`curl -X POST "${process.env.GRAPH_ENDPOINT}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: epi-single ${process.env.GRAPH_SINGLE_KEY}" \\
  -d '{"query": "{ _Content(limit: 1) { items { _metadata { displayName } } } }"}'`);

console.log('\n---\n');

// Check CMA credentials
console.log('CMA Configuration:');
console.log('- Base URL:', process.env.CMA_BASE_URL);
console.log('- Token Endpoint:', process.env.CMA_TOKEN_ENDPOINT);
console.log('- Client ID:', process.env.CMA_CLIENT_ID ? `${process.env.CMA_CLIENT_ID.substring(0, 10)}...` : 'NOT SET');
console.log('- Client Secret:', process.env.CMA_CLIENT_SECRET ? 'SET' : 'NOT SET');

// Test CMA OAuth
console.log('\nTesting CMA OAuth2 authentication...');
try {
  const response = await fetch(process.env.CMA_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: process.env.CMA_CLIENT_ID,
      client_secret: process.env.CMA_CLIENT_SECRET,
      grant_type: 'client_credentials'
    })
  });

  const data = await response.json();
  
  if (response.ok) {
    console.log('✓ OAuth2 authentication successful!');
    console.log('- Token Type:', data.token_type);
    console.log('- Expires In:', data.expires_in, 'seconds');
    console.log('- Access Token:', data.access_token.substring(0, 20) + '...');
    
    // Try to use the token
    console.log('\nTesting CMA API access with token...');
    const apiResponse = await fetch(`${process.env.CMA_BASE_URL}/content`, {
      headers: {
        'Authorization': `Bearer ${data.access_token}`,
        'Accept': 'application/json'
      }
    });
    
    if (apiResponse.ok) {
      console.log('✓ CMA API access successful!');
      const content = await apiResponse.json();
      console.log('- Response type:', Array.isArray(content) ? 'Array' : typeof content);
    } else {
      console.log('✗ CMA API access failed:', apiResponse.status, apiResponse.statusText);
      const errorText = await apiResponse.text();
      console.log('- Error:', errorText.substring(0, 200));
    }
    
  } else {
    console.log('✗ OAuth2 authentication failed:', response.status);
    console.log('- Error:', data);
  }
} catch (error) {
  console.log('✗ Network error:', error.message);
}

console.log('\n---\n');
console.log('Troubleshooting tips:');
console.log('1. For GraphQL: Check if your single key is valid and not expired');
console.log('2. For GraphQL: The 403 error might mean IP restrictions or invalid key');
console.log('3. For CMA: Ensure API keys were created in Settings > API Keys');
console.log('4. For CMA: Check if the preview3/experimental API is enabled for your instance');