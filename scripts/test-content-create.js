#!/usr/bin/env node

import { config } from 'dotenv';
config();

console.log('Content Creation Test');
console.log('====================\n');

// Get OAuth token first
async function getToken() {
  const tokenResponse = await fetch(process.env.CMA_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.CMA_CLIENT_ID,
      client_secret: process.env.CMA_CLIENT_SECRET,
    })
  });

  if (!tokenResponse.ok) {
    throw new Error(`Token request failed: ${tokenResponse.status}`);
  }

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

// Test content creation
async function testContentCreate() {
  try {
    console.log('1. Getting OAuth token...');
    const token = await getToken();
    console.log('✅ Token obtained successfully\n');

    // Test different endpoint variations
    const endpoints = [
      `${process.env.CMA_BASE_URL}/content`,
      `${process.env.CMA_BASE_URL}/experimental/content`,
      'https://api.cms.optimizely.com/preview3/experimental/content',
    ];

    // Article content
    const articleData = {
      contentType: ['ArticlePage'],
      name: 'Understanding MCP Servers',
      language: 'en',
      properties: {
        'ArticleTitle': 'Understanding Model Context Protocol (MCP) Servers',
        'ArticleIntroduction': 'MCP servers provide a standardized way for AI assistants to interact with external systems.',
        'ArticleBody': `
          <h2>What are MCP Servers?</h2>
          <p>Model Context Protocol (MCP) servers are a new standard for connecting AI assistants like Claude to external data sources and tools. They enable structured communication between AI models and various systems.</p>
          
          <h2>Key Benefits</h2>
          <ul>
            <li>Standardized protocol for tool integration</li>
            <li>Secure local execution</li>
            <li>Support for multiple transport methods</li>
            <li>Easy integration with existing systems</li>
          </ul>
          
          <h2>How MCP Servers Work</h2>
          <p>MCP servers communicate using JSON-RPC over standard input/output (stdio). This approach ensures security while providing flexibility in how tools are implemented.</p>
        `,
        'MetaTitle': 'Understanding MCP Servers - Model Context Protocol Guide',
        'MetaDescription': 'Learn about Model Context Protocol (MCP) servers and how they enable AI assistants to interact with external systems securely and efficiently.'
      }
    };

    // Try each endpoint
    for (const endpoint of endpoints) {
      console.log(`2. Testing endpoint: ${endpoint}`);
      
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(articleData)
        });

        console.log(`   Status: ${response.status} ${response.statusText}`);
        
        const responseText = await response.text();
        console.log('   Response:', responseText.substring(0, 200));
        
        if (response.ok) {
          console.log('✅ Content created successfully!');
          const content = JSON.parse(responseText);
          console.log('   Content ID:', content.contentLink?.id);
          console.log('   Content Name:', content.name);
          break;
        } else if (response.status === 404) {
          console.log('❌ Endpoint not found');
        } else if (response.status === 400) {
          console.log('❌ Bad request - check content type and properties');
          try {
            const error = JSON.parse(responseText);
            console.log('   Error details:', JSON.stringify(error, null, 2));
          } catch (e) {
            // Not JSON
          }
        } else {
          console.log('❌ Request failed');
        }
        
        console.log('');
      } catch (error) {
        console.log('   Network error:', error.message);
        console.log('');
      }
    }

    // Also test content type listing to see what's available
    console.log('\n3. Checking available content types...');
    const typesEndpoint = `${process.env.CMA_BASE_URL}/contenttypes`;
    
    const typesResponse = await fetch(typesEndpoint, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    
    if (typesResponse.ok) {
      const types = await typesResponse.json();
      console.log('Available content types:', types.map(t => t.name).slice(0, 10).join(', '));
    } else {
      console.log('Could not fetch content types:', typesResponse.status);
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

testContentCreate();