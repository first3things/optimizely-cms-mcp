#!/usr/bin/env node

/**
 * Quick connectivity test for Optimizely APIs
 * 
 * Fast verification that APIs are accessible
 * Usage: npm run test:quick
 */

import { config } from 'dotenv';
import { OptimizelyGraphClient } from '../dist/clients/graph-client.js';
import { OptimizelyContentClient } from '../dist/clients/cma-client.js';
import { getConfig, getGraphConfig, getCMAConfig } from '../dist/config.js';

config();

async function quickTest() {
  console.log('🚀 Quick API Test\n');
  
  let graphOk = false;
  let cmaOk = false;
  
  // Test Graph
  try {
    const fullConfig = getConfig();
    const graphConfig = getGraphConfig(fullConfig);
    
    const graphClient = new OptimizelyGraphClient(graphConfig);
    await graphClient.query('{ _Content(limit: 1) { total } }');
    console.log('✅ Graph API: Connected');
    graphOk = true;
  } catch (error) {
    console.log(`❌ Graph API: ${error.message}`);
  }
  
  // Test CMA
  try {
    const fullConfig = getConfig();
    const cmaConfig = getCMAConfig(fullConfig);
    
    const cmaClient = new OptimizelyContentClient(cmaConfig);
    await cmaClient.testConnection();
    console.log('✅ CMA API: Connected');
    cmaOk = true;
  } catch (error) {
    console.log(`❌ CMA API: ${error.message}`);
  }
  
  console.log('\nStatus:', graphOk && cmaOk ? '✅ All systems operational' : '⚠️  Some APIs unavailable');
}

quickTest().catch(console.error);