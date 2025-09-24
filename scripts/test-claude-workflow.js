#!/usr/bin/env node

// This script demonstrates the correct workflow for creating content

console.log('='.repeat(60));
console.log('OPTIMIZELY MCP SERVER - CONTENT CREATION GUIDE');
console.log('='.repeat(60));
console.log('');

console.log('PROBLEM: The content-create tool requires:');
console.log('1. A valid contentType (e.g., "StandardPage", "ArticlePage")');
console.log('2. A container GUID (parent page ID)');
console.log('');

console.log('SOLUTION: Use the intelligent tools!');
console.log('');

console.log('METHOD 1: Find parent then create');
console.log('-'.repeat(40));
console.log('Step 1: Find the homepage or parent page');
console.log('Tool: content_find_by_name');
console.log('Parameters:');
console.log(JSON.stringify({
  name: "Home"
}, null, 2));
console.log('');

console.log('Step 2: Use the GUID from step 1 to create content');
console.log('Tool: content-create');
console.log('Parameters:');
console.log(JSON.stringify({
  contentType: "ArticlePage",
  name: "benefits-of-mcp-servers",
  displayName: "Benefits of MCP Servers for Optimizely",
  container: "<GUID-FROM-STEP-1>",
  properties: {
    Title: "The Benefits of MCP Servers for Optimizely CMS",
    MainBody: "<article content here>",
    Author: "Technical Team"
  }
}, null, 2));
console.log('');

console.log('METHOD 2: Use intelligent creation (EASIER!)');
console.log('-'.repeat(40));
console.log('Tool: content_create_under');
console.log('Parameters:');
console.log(JSON.stringify({
  parentName: "Home",
  contentType: "ArticlePage", 
  name: "benefits-of-mcp-servers",
  displayName: "Benefits of MCP Servers for Optimizely",
  properties: {
    Title: "The Benefits of MCP Servers for Optimizely CMS",
    MainBody: "<article content here>",
    Author: "Technical Team"
  }
}, null, 2));
console.log('');

console.log('METHOD 3: Use the wizard (INTERACTIVE!)');
console.log('-'.repeat(40));
console.log('Tool: content_creation_wizard');
console.log('Start with:');
console.log(JSON.stringify({
  step: "start"
}, null, 2));
console.log('');

console.log('COMMON CONTENT TYPES:');
console.log('- StandardPage');
console.log('- ArticlePage');
console.log('- NewsPage');
console.log('- BlogPost');
console.log('- ProductPage');
console.log('');

console.log('TIPS:');
console.log('1. If you don\'t know the parent GUID, use content_find_by_name first');
console.log('2. The intelligent tools (content_create_under) handle finding the parent for you');
console.log('3. Check content_site_info for more guidance');
console.log('');