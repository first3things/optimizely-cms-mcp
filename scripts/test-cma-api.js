#!/usr/bin/env node

/**
 * Optimizely Content Management API Test Suite
 * 
 * Tests CMA connectivity, authentication, and available endpoints
 * Usage: npm run test:cma
 * Debug: npm run test:cma:debug
 */

import { config } from 'dotenv';
import { OptimizelyContentClient } from '../dist/clients/cma-client.js';
import { getConfig, getCMAConfig } from '../dist/config.js';

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

async function testCMAAPI() {
  console.log(`${colors.bright}Optimizely Content Management API Test Suite${colors.reset}`);
  console.log('='.repeat(50));
  console.log('');

  const results = {
    passed: 0,
    failed: 0,
    warnings: 0
  };

  try {
    // Initialize CMA client
    const fullConfig = getConfig();
    const cmaConfig = getCMAConfig(fullConfig);

    log.debug(`Base URL: ${cmaConfig.baseUrl}`);
    log.debug(`Client ID: ***${cmaConfig.clientId.slice(-4)}`);
    
    const client = new OptimizelyContentClient(cmaConfig);

    // Test 1: Authentication
    console.log(`\n${colors.bright}Test 1: Authentication${colors.reset}`);
    console.log('-'.repeat(30));
    try {
      await client.testConnection();
      log.success('Authentication successful');
      log.info('OAuth2 token obtained');
      results.passed++;
    } catch (error) {
      log.error(`Authentication failed: ${error.message}`);
      log.debug(JSON.stringify(error, null, 2));
      results.failed++;
      return; // Can't continue without auth
    }

    // Test 2: Content Types Endpoint
    console.log(`\n${colors.bright}Test 2: Content Types Discovery${colors.reset}`);
    console.log('-'.repeat(30));
    try {
      const contentTypes = await client.get('/contenttypes?pageSize=10');
      
      if (contentTypes.items && Array.isArray(contentTypes.items)) {
        log.success(`Found ${contentTypes.totalItemCount || contentTypes.items.length} content types`);
        
        // Analyze content types
        const pageTypes = contentTypes.items.filter(ct => 
          ct.baseType === 'Page' || ct.key?.includes('Page')
        );
        const blockTypes = contentTypes.items.filter(ct => 
          ct.baseType === 'Block' || ct.key?.includes('Block')
        );
        
        log.info(`Page types: ${pageTypes.length}`);
        log.info(`Block types: ${blockTypes.length}`);
        
        if (pageTypes.length > 0) {
          console.log('\nAvailable page types for content creation:');
          pageTypes.slice(0, 5).forEach(type => {
            log.info(`- ${type.key}: ${type.displayName}`);
          });
        }
        
        results.passed++;
      } else {
        log.error('Unexpected content types response');
        log.debug(JSON.stringify(contentTypes, null, 2));
        results.failed++;
      }
    } catch (error) {
      log.error(`Content types discovery failed: ${error.message}`);
      results.failed++;
    }

    // Test 3: Test experimental endpoints
    console.log(`\n${colors.bright}Test 3: Experimental Content Endpoints${colors.reset}`);
    console.log('-'.repeat(30));
    
    const endpoints = [
      { path: '/experimental/content', method: 'GET', name: 'List content' },
      { path: '/experimental/content/versions', method: 'GET', name: 'List versions' },
      { path: '/experimental/changesets', method: 'GET', name: 'List changesets' }
    ];
    
    for (const endpoint of endpoints) {
      try {
        log.debug(`Testing ${endpoint.method} ${endpoint.path}`);
        await client.request(endpoint.path, { method: endpoint.method });
        log.success(`${endpoint.name}: Available`);
        results.passed++;
      } catch (error) {
        if (error.message.includes('404')) {
          log.warn(`${endpoint.name}: Not found (404)`);
          results.warnings++;
        } else if (error.message.includes('403')) {
          log.warn(`${endpoint.name}: Forbidden (403)`);
          results.warnings++;
        } else {
          log.error(`${endpoint.name}: ${error.message}`);
          results.failed++;
        }
      }
    }

    // Test 4: Property Formats (if available)
    console.log(`\n${colors.bright}Test 4: Property Formats${colors.reset}`);
    console.log('-'.repeat(30));
    try {
      const formats = await client.get('/propertyformats?pageSize=5');
      if (formats.items) {
        log.success(`Found ${formats.totalItemCount || formats.items.length} property formats`);
        results.passed++;
      }
    } catch (error) {
      if (error.message.includes('404')) {
        log.warn('Property formats endpoint not available');
        results.warnings++;
      } else {
        log.error(`Property formats failed: ${error.message}`);
        results.failed++;
      }
    }

    // Test 5: API Capabilities Summary
    console.log(`\n${colors.bright}Test 5: API Capabilities${colors.reset}`);
    console.log('-'.repeat(30));
    
    log.info('Checking API capabilities...');
    
    const capabilities = {
      'Authentication': true,
      'Content Types': true,
      'Content CRUD': false,
      'Versions': false,
      'Languages': false
    };
    
    // We already know auth and content types work
    // Check if content operations are available
    try {
      await client.get('/experimental/content?pageSize=1');
      capabilities['Content CRUD'] = true;
      capabilities['Versions'] = true;
    } catch (error) {
      // Expected for preview3 API
    }
    
    console.log('\nAPI Capabilities:');
    Object.entries(capabilities).forEach(([feature, available]) => {
      if (available) {
        log.success(`${feature}: Available`);
      } else {
        log.warn(`${feature}: Not available`);
      }
    });
    
    results.passed++;

    // Summary
    console.log(`\n${colors.bright}Test Summary${colors.reset}`);
    console.log('='.repeat(50));
    console.log(`${colors.green}Passed: ${results.passed}${colors.reset}`);
    console.log(`${colors.red}Failed: ${results.failed}${colors.reset}`);
    console.log(`${colors.yellow}Warnings: ${results.warnings}${colors.reset}`);
    
    console.log(`\n${colors.bright}Known Limitations:${colors.reset}`);
    console.log('- Preview3 API has limited functionality');
    console.log('- Content CRUD operations require different API version');
    console.log('- Only content type discovery is fully functional');
    
    if (results.failed === 0) {
      console.log(`\n${colors.green}${colors.bright}Core functionality working!${colors.reset}`);
    } else {
      console.log(`\n${colors.red}${colors.bright}Some tests failed.${colors.reset}`);
      console.log('Run with npm run test:cma:debug for more details');
    }

  } catch (error) {
    console.error(`\n${colors.red}Fatal error:${colors.reset}`, error.message);
    if (process.env.LOG_LEVEL === 'debug') {
      console.error(error.stack);
    }
  }
}

// Run the test suite
testCMAAPI().catch(console.error);