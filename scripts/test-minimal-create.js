#!/usr/bin/env node

import { config } from 'dotenv';
config();

async function test() {
  // Get token
  const tokenResp = await fetch(process.env.CMA_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.CMA_CLIENT_ID,
      client_secret: process.env.CMA_CLIENT_SECRET,
    })
  });
  
  const { access_token } = await tokenResp.json();
  console.log('✅ Got token\n');

  // Test minimal content creation with different variations
  const variations = [
    {
      name: "Test 1: Minimal with container",
      data: {
        contentType: "StandardPage",
        name: "Test MCP Article",
        displayName: "Test MCP Article", 
        container: "00000000-0000-0000-0000-000000000001", // Root container GUID
        language: "en"
      }
    },
    {
      name: "Test 2: With properties",
      data: {
        contentType: "StandardPage",
        name: "MCP Server Guide",
        displayName: "MCP Server Guide",
        container: "1",
        language: "en",
        properties: {
          "MainBody": "<p>This is a test article about MCP servers.</p>"
        }
      }
    },
    {
      name: "Test 3: Different content type",
      data: {
        contentType: "ArticlePage",
        name: "MCP Article",
        displayName: "MCP Article", 
        container: "1",
        language: "en"
      }
    }
  ];

  for (const variation of variations) {
    console.log(`\n${variation.name}`);
    console.log('Request:', JSON.stringify(variation.data, null, 2));
    
    const response = await fetch(`${process.env.CMA_BASE_URL}/content`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(variation.data)
    });

    const text = await response.text();
    console.log(`Response: ${response.status} ${response.statusText}`);
    
    try {
      const json = JSON.parse(text);
      if (response.ok) {
        console.log('✅ Success! Content ID:', json.contentLink?.id);
        // If successful, try to read it back
        const readResp = await fetch(`${process.env.CMA_BASE_URL}/content/${json.contentLink.id}`, {
          headers: {
            'Authorization': `Bearer ${access_token}`,
            'Accept': 'application/json'
          }
        });
        if (readResp.ok) {
          const content = await readResp.json();
          console.log('Content type schema:', content.contentType);
        }
        break; // Stop on first success
      } else {
        console.log('❌ Error:', json.detail || json.title);
        if (json.errors) {
          json.errors.forEach(e => console.log(`  - ${e.field}: ${e.detail}`));
        }
      }
    } catch (e) {
      console.log('Response:', text.substring(0, 200));
    }
  }

  // Try to list existing content to understand structure
  console.log('\n\nListing existing content...');
  const listResp = await fetch(`${process.env.CMA_BASE_URL}/content?$top=2`, {
    headers: {
      'Authorization': `Bearer ${access_token}`,
      'Accept': 'application/json'
    }
  });

  if (listResp.ok) {
    const data = await listResp.json();
    console.log('Sample content structure:');
    if (data.value && data.value.length > 0) {
      const sample = data.value[0];
      console.log('- Content Type:', sample.contentType);
      console.log('- Container:', sample.container);
      console.log('- Language:', sample.language);
      console.log('- Properties:', Object.keys(sample.properties || {}));
    }
  } else {
    console.log('Could not list content:', listResp.status);
  }
}

test().catch(console.error);