#!/usr/bin/env node

import { config } from 'dotenv';
import { OptimizelyGraphClient } from '../dist/clients/graph-client.js';
import { getGraphConfig } from '../dist/config.js';

config();

async function findHomeAndContentTypes() {
  console.log('Finding Home Page and Available Content Types');
  console.log('='.repeat(50));
  console.log('');

  try {
    // Initialize GraphQL client
    const graphConfig = getGraphConfig({ 
      graph: {
        endpoint: process.env.GRAPH_ENDPOINT,
        authMethod: process.env.GRAPH_AUTH_METHOD,
        credentials: {
          singleKey: process.env.GRAPH_SINGLE_KEY
        }
      },
      options: {}
    });
    
    const client = new OptimizelyGraphClient(graphConfig);

    // 1. Search for Home/Start page
    console.log('1. Searching for Home/Start page...');
    const homeQuery = `
      query FindHome {
        Content(
          where: { 
            _or: [
              { Name: { eq: "Home" } }
              { Name: { eq: "Start" } }
              { Name: { eq: "Root" } }
              { DisplayName: { eq: "Home" } }
              { DisplayName: { eq: "Start" } }
            ]
          }
          limit: 5
        ) {
          items {
            ContentLink {
              Id
              GuidValue
            }
            Name
            DisplayName
            ContentType
            Url
            RelativePath
          }
        }
      }
    `;

    const homeResult = await client.query(homeQuery);
    console.log('\nPotential Home Pages Found:');
    console.log('-'.repeat(50));
    
    if (homeResult.Content?.items?.length > 0) {
      homeResult.Content.items.forEach((item, index) => {
        console.log(`\n${index + 1}. ${item.Name || item.DisplayName}`);
        console.log(`   ID: ${item.ContentLink.Id}`);
        console.log(`   GUID: ${item.ContentLink.GuidValue}`);
        console.log(`   Type: ${Array.isArray(item.ContentType) ? item.ContentType[0] : item.ContentType}`);
        console.log(`   URL: ${item.Url || item.RelativePath || 'N/A'}`);
      });

      console.log('\n📋 TO USE IN CLAUDE:');
      console.log('Copy this GUID for the Home page:');
      console.log(`"container": "${homeResult.Content.items[0].ContentLink.GuidValue}"`);
    } else {
      console.log('❌ No Home/Start page found!');
    }

    // 2. Find common content types
    console.log('\n\n2. Looking for content types...');
    const typesQuery = `
      query GetContentTypes {
        Content(limit: 20) {
          items {
            ContentType
          }
          facets {
            ContentType(limit: 20) {
              name
              count
            }
          }
        }
      }
    `;

    const typesResult = await client.query(typesQuery);
    
    console.log('\nAvailable Content Types:');
    console.log('-'.repeat(50));
    
    if (typesResult.Content?.facets?.ContentType) {
      const types = typesResult.Content.facets.ContentType;
      types.forEach(type => {
        console.log(`- ${type.name} (${type.count} items)`);
      });
      
      console.log('\n📋 COMMON CONTENT TYPES TO USE:');
      const commonTypes = types.filter(t => 
        t.name.includes('Page') || 
        t.name.includes('Article') || 
        t.name.includes('Block')
      );
      
      if (commonTypes.length > 0) {
        console.log('Try one of these:');
        commonTypes.forEach(t => console.log(`"contentType": "${t.name}"`));
      }
    } else {
      // Fallback: look at actual content
      const uniqueTypes = [...new Set(
        typesResult.Content?.items
          ?.map(item => Array.isArray(item.ContentType) ? item.ContentType[0] : item.ContentType)
          ?.filter(Boolean) || []
      )];
      
      if (uniqueTypes.length > 0) {
        console.log('Found these content types:');
        uniqueTypes.forEach(type => console.log(`- ${type}`));
      }
    }

    // 3. Show example for Claude
    console.log('\n\n' + '='.repeat(50));
    console.log('EXAMPLE FOR CLAUDE TO USE:');
    console.log('='.repeat(50));
    
    const homeGuid = homeResult.Content?.items?.[0]?.ContentLink?.GuidValue;
    const exampleType = typesResult.Content?.facets?.ContentType?.[0]?.name || 'StandardPage';
    
    if (homeGuid) {
      console.log('\nMethod 1 - Direct creation with GUID:');
      console.log('```json');
      console.log(JSON.stringify({
        tool: "content-create",
        params: {
          contentType: exampleType,
          name: "benefits-of-mcp-servers",
          displayName: "Benefits of MCP Servers",
          container: homeGuid,
          properties: {
            Title: "The Benefits of MCP Servers for Optimizely CMS",
            MainBody: "<p>Article content...</p>"
          }
        }
      }, null, 2));
      console.log('```');
    }

    console.log('\nMethod 2 - Smart creation (RECOMMENDED):');
    console.log('```json');
    console.log(JSON.stringify({
      tool: "content_create_under",
      params: {
        parentName: "Home",
        contentType: exampleType,
        name: "benefits-of-mcp-servers",
        displayName: "Benefits of MCP Servers",
        properties: {
          Title: "The Benefits of MCP Servers for Optimizely CMS",
          MainBody: "<p>Article content...</p>"
        }
      }
    }, null, 2));
    console.log('```');

  } catch (error) {
    console.error('Error:', error.message);
    console.log('\nMake sure your GraphQL credentials are correct in .env');
  }
}

findHomeAndContentTypes();