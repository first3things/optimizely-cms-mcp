#!/usr/bin/env node

import { config } from 'dotenv';
config();

async function getToken() {
  const response = await fetch(process.env.CMA_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.CMA_CLIENT_ID,
      client_secret: process.env.CMA_CLIENT_SECRET,
    })
  });
  
  const data = await response.json();
  return data.access_token;
}

async function exploreCMA() {
  const token = await getToken();
  console.log('✅ Authenticated\n');

  // Endpoints to explore
  const endpoints = [
    // Content endpoints
    { method: 'GET', path: '/content', desc: 'List content' },
    { method: 'GET', path: '/content?$top=1', desc: 'List content (limit 1)' },
    { method: 'GET', path: '/contents', desc: 'List contents (plural)' },
    
    // Site/container endpoints
    { method: 'GET', path: '/sites', desc: 'List sites' },
    { method: 'GET', path: '/site', desc: 'Get site' },
    { method: 'GET', path: '/containers', desc: 'List containers' },
    { method: 'GET', path: '/roots', desc: 'Get root containers' },
    { method: 'GET', path: '/startpage', desc: 'Get start page' },
    
    // Content type endpoints
    { method: 'GET', path: '/contenttypes', desc: 'List content types' },
    { method: 'GET', path: '/contenttypes?$top=1', desc: 'List content types (limit 1)' },
    
    // Other endpoints
    { method: 'GET', path: '/languages', desc: 'List languages' },
    { method: 'GET', path: '/users', desc: 'List users' },
    { method: 'GET', path: '/', desc: 'API root' },
    { method: 'GET', path: '/metadata', desc: 'API metadata' },
    { method: 'GET', path: '/$metadata', desc: 'OData metadata' },
  ];

  console.log('Exploring CMA API endpoints...\n');

  for (const endpoint of endpoints) {
    const url = process.env.CMA_BASE_URL + endpoint.path;
    
    try {
      const response = await fetch(url, {
        method: endpoint.method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      console.log(`${endpoint.method} ${endpoint.path} - ${endpoint.desc}`);
      console.log(`Status: ${response.status} ${response.statusText}`);
      
      if (response.ok) {
        const text = await response.text();
        try {
          const data = JSON.parse(text);
          
          // Show relevant information
          if (data.value && Array.isArray(data.value)) {
            console.log(`✅ Found ${data.value.length} items`);
            if (data.value.length > 0) {
              const item = data.value[0];
              console.log('Sample item:', JSON.stringify(item, null, 2).substring(0, 300) + '...');
            }
          } else if (Array.isArray(data)) {
            console.log(`✅ Found ${data.length} items`);
            if (data.length > 0) {
              console.log('Sample:', JSON.stringify(data[0], null, 2).substring(0, 300) + '...');
            }
          } else {
            console.log('✅ Response:', JSON.stringify(data, null, 2).substring(0, 300) + '...');
          }
        } catch (e) {
          console.log('✅ Response (text):', text.substring(0, 200));
        }
      } else if (response.status === 404) {
        console.log('❌ Not found');
      } else if (response.status === 405) {
        console.log('❌ Method not allowed');
      } else {
        const error = await response.text();
        console.log('❌ Error:', error.substring(0, 200));
      }
      
      console.log('---\n');
      
    } catch (error) {
      console.log(`${endpoint.method} ${endpoint.path} - ${endpoint.desc}`);
      console.log('❌ Network error:', error.message);
      console.log('---\n');
    }
  }

  // Try to find the site structure
  console.log('\nTrying to understand site structure...\n');
  
  // Check if we can get content by well-known IDs
  const wellKnownIds = [
    { id: '1', desc: 'Root (numeric)' },
    { id: '00000000-0000-0000-0000-000000000000', desc: 'Empty GUID' },
    { id: '00000000-0000-0000-0000-000000000001', desc: 'Root GUID pattern' },
  ];

  for (const item of wellKnownIds) {
    try {
      const response = await fetch(`${process.env.CMA_BASE_URL}/content/${item.id}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });
      
      console.log(`GET /content/${item.id} - ${item.desc}`);
      console.log(`Status: ${response.status}`);
      
      if (response.ok) {
        const content = await response.json();
        console.log('✅ Found content:', JSON.stringify(content, null, 2).substring(0, 300));
      }
      console.log('---\n');
    } catch (error) {
      console.log(`Error checking ${item.id}:`, error.message);
    }
  }
}

exploreCMA().catch(console.error);