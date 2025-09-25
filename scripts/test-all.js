#!/usr/bin/env node

/**
 * Optimizely MCP Server - Complete Test Suite
 * 
 * Runs all API tests and provides a comprehensive status report
 * Usage: npm run test:all
 */

import { config } from 'dotenv';

config();

console.log('\x1b[1m🧪 Optimizely MCP Server Test Suite\x1b[0m');
console.log('='.repeat(50));
console.log('');

async function runAllTests() {
  console.log('Running all tests...\n');
  
  // Run Graph API tests
  console.log('\x1b[36m📊 Running Graph API Tests...\x1b[0m');
  console.log('-'.repeat(50));
  await import('./test-graph-api.js');
  
  console.log('\n');
  
  // Run CMA API tests
  console.log('\x1b[36m📝 Running Content Management API Tests...\x1b[0m');
  console.log('-'.repeat(50));
  await import('./test-cma-api.js');
}

runAllTests().catch(console.error);