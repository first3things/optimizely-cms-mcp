#!/usr/bin/env node

/**
 * Optimizely Graph API Test Suite
 * 
 * Tests GraphQL API connectivity, authentication, and basic queries
 * Usage: npm run test:graph
 * Debug: npm run test:graph:debug
 */

import { config } from 'dotenv';
import { OptimizelyGraphClient } from '../dist/clients/graph-client.js';
import { getGraphConfig } from '../dist/config.js';

config();

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset}  ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset}  ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset}  ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset}  ${msg}`),
  debug: (msg) => {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(`${colors.cyan}[DEBUG]${colors.reset} ${msg}`);
    }
  }
};

async function testGraphAPI() {
  console.log(`${colors.bright}Optimizely Graph API Test Suite${colors.reset}`);
  console.log('='.repeat(50));
  console.log('');

  const results = {
    passed: 0,
    failed: 0,
    warnings: 0
  };

  try {
    // Initialize Graph client
    const graphConfig = getGraphConfig({ 
      graph: {
        singleKey: process.env.GRAPH_SINGLE_KEY,
        appKey: process.env.GRAPH_APP_KEY,
        secret: process.env.GRAPH_SECRET,
        endpoint: process.env.GRAPH_ENDPOINT
      },
      options: {}
    });

    log.debug(`Endpoint: ${graphConfig.endpoint}`);
    log.debug(`Auth type: ${graphConfig.auth.type}`);
    
    const client = new OptimizelyGraphClient(graphConfig);

    // Test 1: Basic connectivity
    console.log(`\n${colors.bright}Test 1: Basic Connectivity${colors.reset}`);
    console.log('-'.repeat(30));
    try {
      const testQuery = `
        query TestConnection {
          _Content(limit: 1) {
            total
          }
        }
      `;
      
      log.debug('Executing test query...');
      const result = await client.request(testQuery);
      
      if (result._Content) {
        log.success('Graph API connection successful');
        log.info(`Total content items: ${result._Content.total || 0}`);
        results.passed++;
      } else {
        log.error('Unexpected response structure');
        results.failed++;
      }
    } catch (error) {
      log.error(`Connection failed: ${error.message}`);
      log.debug(JSON.stringify(error, null, 2));
      results.failed++;
    }

    // Test 2: Content Type Discovery
    console.log(`\n${colors.bright}Test 2: Content Type Discovery${colors.reset}`);
    console.log('-'.repeat(30));
    try {
      const typeQuery = `
        query DiscoverTypes {
          _Content(limit: 5) {
            items {
              _metadata {
                types
              }
            }
          }
        }
      `;
      
      const result = await client.request(typeQuery);
      
      if (result._Content?.items) {
        const types = new Set();
        result._Content.items.forEach(item => {
          if (item._metadata?.types) {
            item._metadata.types.forEach(type => types.add(type));
          }
        });
        
        log.success('Content types discovered');
        log.info(`Found ${types.size} unique types`);
        if (types.size > 0) {
          log.debug(`Types: ${Array.from(types).join(', ')}`);
        }
        results.passed++;
      } else {
        log.warn('No content items found');
        results.warnings++;
      }
    } catch (error) {
      log.error(`Type discovery failed: ${error.message}`);
      results.failed++;
    }

    // Test 3: Search for specific content
    console.log(`\n${colors.bright}Test 3: Content Search${colors.reset}`);
    console.log('-'.repeat(30));
    try {
      const searchQuery = `
        query SearchContent {
          _Content(
            where: { 
              _metadata: { 
                displayName: { contains: "Home" }
              }
            }
            limit: 3
          ) {
            items {
              _metadata {
                key
                displayName
                types
              }
            }
          }
        }
      `;
      
      const result = await client.request(searchQuery);
      
      if (result._Content?.items && result._Content.items.length > 0) {
        log.success(`Found ${result._Content.items.length} items containing "Home"`);
        result._Content.items.forEach(item => {
          log.info(`- ${item._metadata.displayName} (${item._metadata.key})`);
        });
        results.passed++;
      } else {
        log.warn('No content found with "Home" in title');
        results.warnings++;
      }
    } catch (error) {
      log.error(`Search failed: ${error.message}`);
      results.failed++;
    }

    // Test 4: Schema introspection
    console.log(`\n${colors.bright}Test 4: Schema Introspection${colors.reset}`);
    console.log('-'.repeat(30));
    try {
      const introspectionQuery = `
        query IntrospectTypes {
          __schema {
            types {
              name
              kind
            }
          }
        }
      `;
      
      const result = await client.request(introspectionQuery);
      
      if (result.__schema?.types) {
        const contentTypes = result.__schema.types.filter(t => 
          t.kind === 'OBJECT' && 
          !t.name.startsWith('__') && 
          !['Query', 'Mutation'].includes(t.name)
        );
        
        log.success('Schema introspection successful');
        log.info(`Found ${contentTypes.length} content types`);
        
        if (process.env.LOG_LEVEL === 'debug') {
          console.log('\nSample content types:');
          contentTypes.slice(0, 10).forEach(type => {
            log.debug(`- ${type.name}`);
          });
        }
        results.passed++;
      } else {
        log.error('Schema introspection failed');
        results.failed++;
      }
    } catch (error) {
      log.error(`Introspection failed: ${error.message}`);
      results.failed++;
    }

    // Summary
    console.log(`\n${colors.bright}Test Summary${colors.reset}`);
    console.log('='.repeat(50));
    console.log(`${colors.green}Passed: ${results.passed}${colors.reset}`);
    console.log(`${colors.red}Failed: ${results.failed}${colors.reset}`);
    console.log(`${colors.yellow}Warnings: ${results.warnings}${colors.reset}`);
    
    if (results.failed === 0) {
      console.log(`\n${colors.green}${colors.bright}All tests passed!${colors.reset}`);
    } else {
      console.log(`\n${colors.red}${colors.bright}Some tests failed.${colors.reset}`);
      console.log('Run with npm run test:graph:debug for more details');
    }

  } catch (error) {
    console.error(`\n${colors.red}Fatal error:${colors.reset}`, error.message);
    if (process.env.LOG_LEVEL === 'debug') {
      console.error(error.stack);
    }
  }
}

// Run the test suite
testGraphAPI().catch(console.error);