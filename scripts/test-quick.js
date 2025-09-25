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
import { getGraphConfig, getCMAConfig } from '../dist/config.js';

config();

async function quickTest() {
  console.log('🚀 Quick API Test\n');
  
  let graphOk = false;
  let cmaOk = false;
  
  // Test Graph
  try {
    const graphConfig = getGraphConfig({ 
      graph: {
        singleKey: process.env.GRAPH_SINGLE_KEY,
        appKey: process.env.GRAPH_APP_KEY,
        secret: process.env.GRAPH_SECRET,
        endpoint: process.env.GRAPH_ENDPOINT
      },
      options: {}
    });
    
    // Check if we have valid auth configuration
    if (!graphConfig.auth.singleKey && !graphConfig.auth.hmac) {
      console.log('❌ Graph API: Missing authentication credentials');
    } else {
      const graphClient = new OptimizelyGraphClient(graphConfig);
      await graphClient.request('{ _Content(limit: 1) { total } }');
      console.log('✅ Graph API: Connected');
      graphOk = true;
    }
  } catch (error) {
    console.log(`❌ Graph API: ${error.message}`);
  }
  
  // Test CMA
  try {
    const cmaConfig = getCMAConfig({ 
      cma: {
        baseUrl: process.env.CMA_BASE_URL,
        clientId: process.env.CMA_CLIENT_ID,
        clientSecret: process.env.CMA_CLIENT_SECRET,
        grantType: process.env.CMA_GRANT_TYPE,
        tokenEndpoint: process.env.CMA_TOKEN_ENDPOINT
      },
      options: {}
    });
    
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