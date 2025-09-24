#!/usr/bin/env node

import { config } from 'dotenv';
config();

console.log('Testing Content Creation - MCP Server Article');
console.log('=============================================\n');

// Get OAuth token
async function getToken() {
  const response = await fetch(process.env.CMA_TOKEN_ENDPOINT, {
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

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token request failed: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.access_token;
}

// First, let's check what content types are available
async function getContentTypes(token) {
  const response = await fetch(`${process.env.CMA_BASE_URL}/contenttypes`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });

  if (response.ok) {
    const data = await response.json();
    return data;
  }
  return null;
}

// Create the article
async function createArticle(token) {
  // Article content about MCP servers
  const articleData = {
    contentType: "StandardPage", // Using a common content type
    name: "Understanding MCP Servers - Model Context Protocol",
    displayName: "Understanding MCP Servers",
    language: "en",
    properties: {
      "PageName": "Understanding MCP Servers - Model Context Protocol",
      "Title": "Understanding Model Context Protocol (MCP) Servers",
      "MainBody": `<h2>What are MCP Servers?</h2>
<p>Model Context Protocol (MCP) servers represent a groundbreaking approach to extending AI capabilities. They provide a standardized way for AI assistants like Claude to interact with external tools and data sources while maintaining security and reliability.</p>

<h2>The Power of MCP</h2>
<p>MCP servers enable AI models to:</p>
<ul>
  <li>Access real-time data from various sources</li>
  <li>Perform complex operations through well-defined tools</li>
  <li>Integrate seamlessly with existing systems</li>
  <li>Maintain security through local execution</li>
</ul>

<h2>How MCP Works</h2>
<p>The protocol uses JSON-RPC communication over standard input/output (stdio), ensuring that:</p>
<ol>
  <li>No network ports are exposed</li>
  <li>Communication is secure and controlled</li>
  <li>Integration is simple and straightforward</li>
</ol>

<h2>Real-World Applications</h2>
<p>MCP servers can be used for:</p>
<ul>
  <li><strong>Content Management:</strong> Managing CMS content programmatically</li>
  <li><strong>Data Analysis:</strong> Accessing databases and analytics tools</li>
  <li><strong>System Integration:</strong> Connecting to enterprise systems</li>
  <li><strong>Development Tools:</strong> Interacting with code repositories and CI/CD pipelines</li>
</ul>

<h2>Building Your Own MCP Server</h2>
<p>Creating an MCP server involves:</p>
<ol>
  <li>Implementing the MCP protocol using the official SDK</li>
  <li>Defining tools that expose specific functionality</li>
  <li>Handling authentication and security</li>
  <li>Testing and documenting your server</li>
</ol>

<h2>The Future of AI Integration</h2>
<p>MCP represents a significant step forward in making AI assistants more capable and useful. By providing a standard protocol for tool integration, it opens up endless possibilities for extending AI functionality while maintaining security and control.</p>`,
      "MetaTitle": "Understanding MCP Servers - Model Context Protocol Guide",
      "MetaDescription": "Learn about Model Context Protocol (MCP) servers and how they enable secure, powerful integrations between AI assistants and external systems.",
      "Introduction": "MCP servers provide a standardized protocol for AI assistants to interact with external tools and data sources. This guide explores their capabilities and implementation."
    }
  };

  console.log('Creating article with data:');
  console.log(JSON.stringify(articleData, null, 2));
  console.log('');

  const response = await fetch(`${process.env.CMA_BASE_URL}/content`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(articleData)
  });

  console.log(`Response Status: ${response.status} ${response.statusText}`);
  
  const responseText = await response.text();
  
  try {
    const responseData = JSON.parse(responseText);
    console.log('Response:', JSON.stringify(responseData, null, 2));
    
    if (response.ok) {
      console.log('\n✅ Article created successfully!');
      console.log('Content ID:', responseData.contentLink?.id);
      console.log('Content GUID:', responseData.contentLink?.guidValue);
    } else {
      console.log('\n❌ Failed to create article');
      
      // If content type doesn't exist, suggest alternatives
      if (responseData.errors && responseData.errors.some(e => e.field === 'contentType')) {
        console.log('\n💡 Tip: The content type "ArticlePage" might not exist.');
        console.log('Run this script with --list-types to see available content types.');
      }
    }
  } catch (e) {
    console.log('Response (raw):', responseText);
  }
}

// Main function
async function main() {
  try {
    // Get auth token
    console.log('1. Authenticating...');
    const token = await getToken();
    console.log('✅ Authentication successful\n');

    // Check if we should list types
    if (process.argv.includes('--list-types')) {
      console.log('2. Fetching available content types...');
      const types = await getContentTypes(token);
      
      if (types) {
        console.log('\nAvailable content types:');
        if (Array.isArray(types)) {
          types.forEach(type => {
            console.log(`- ${type.name || type.Name || type}`);
          });
        } else if (types.value) {
          // OData format
          types.value.forEach(type => {
            console.log(`- ${type.Name} (${type.DisplayName})`);
          });
        } else {
          console.log(JSON.stringify(types, null, 2));
        }
      } else {
        console.log('Could not fetch content types');
      }
      return;
    }

    // Create the article
    console.log('2. Creating article about MCP servers...\n');
    await createArticle(token);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

// Run with --list-types to see available content types
if (process.argv.includes('--help')) {
  console.log('Usage:');
  console.log('  node test-create-article.js           Create the test article');
  console.log('  node test-create-article.js --list-types  List available content types');
  console.log('  node test-create-article.js --help        Show this help');
} else {
  main();
}