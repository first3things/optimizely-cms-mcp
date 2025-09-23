#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serverPath = path.join(__dirname, 'dist', 'index.js');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function callTool(toolName, args = {}) {
  return new Promise((resolve, reject) => {
    const server = spawn('node', [serverPath], {
      env: { ...process.env }
    });
    
    const request = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      },
      id: Date.now()
    };
    
    let output = '';
    let errorOutput = '';
    
    server.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    server.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    server.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Server exited with code ${code}: ${errorOutput}`));
        return;
      }
      
      try {
        const lines = output.split('\n').filter(line => line.trim());
        const responseLine = lines.find(line => line.includes('"jsonrpc"'));
        if (responseLine) {
          const response = JSON.parse(responseLine);
          resolve(response);
        } else {
          reject(new Error('No valid response received'));
        }
      } catch (error) {
        reject(error);
      }
    });
    
    // Send the request
    server.stdin.write(JSON.stringify(request) + '\n');
    server.stdin.end();
  });
}

async function runTests() {
  console.log(`${colors.bright}${colors.blue}Optimizely MCP Server Quick Test${colors.reset}`);
  console.log('=================================\n');
  
  const tests = [
    {
      name: '1. Testing Connectivity',
      tool: 'test_connection',
      args: {},
      processResult: (result) => {
        if (result.error) return { success: false, message: result.error.message };
        const data = JSON.parse(result.result.content[0].text);
        return {
          success: data.healthy,
          message: `GraphQL: ${data.graphQL.connected ? 'Connected' : 'Failed'}, CMA: ${data.contentAPI.connected ? 'Connected' : 'Failed'}`
        };
      }
    },
    {
      name: '2. Health Check',
      tool: 'health_check',
      args: {},
      processResult: (result) => {
        if (result.error) return { success: false, message: result.error.message };
        const data = JSON.parse(result.result.content[0].text);
        return {
          success: data.status === 'healthy',
          message: `Server: ${data.server.name} v${data.server.version}, Tools: ${data.toolsCount}`
        };
      }
    },
    {
      name: '3. Listing Content Types',
      tool: 'type_list',
      args: { includeSystemTypes: false },
      processResult: (result) => {
        if (result.error) return { success: false, message: result.error.message };
        try {
          const data = JSON.parse(result.result.content[0].text);
          return {
            success: true,
            message: `Found ${data.totalTypes} content types`
          };
        } catch (e) {
          return { success: false, message: 'Failed to parse response' };
        }
      }
    },
    {
      name: '4. Searching Content (GraphQL)',
      tool: 'graph_search',
      args: { query: 'page', limit: 5 },
      processResult: (result) => {
        if (result.error) return { success: false, message: result.error.message };
        try {
          const data = JSON.parse(result.result.content[0].text);
          return {
            success: true,
            message: `Found ${data.total || 0} items${data.items?.length > 0 ? `, first: "${data.items[0].name}"` : ''}`
          };
        } catch (e) {
          return { success: false, message: 'Failed to parse response' };
        }
      }
    },
    {
      name: '5. Autocomplete Test',
      tool: 'graph_autocomplete',
      args: { query: 'a', limit: 3 },
      processResult: (result) => {
        if (result.error) return { success: false, message: result.error.message };
        try {
          const data = JSON.parse(result.result.content[0].text);
          return {
            success: true,
            message: `Found ${data.suggestions?.length || 0} suggestions`
          };
        } catch (e) {
          return { success: false, message: 'Failed to parse response' };
        }
      }
    }
  ];
  
  let successCount = 0;
  let failureCount = 0;
  
  for (const test of tests) {
    console.log(`${colors.cyan}${test.name}${colors.reset}`);
    
    try {
      const startTime = Date.now();
      const result = await callTool(test.tool, test.args);
      const duration = Date.now() - startTime;
      
      const processed = test.processResult(result);
      
      if (processed.success) {
        console.log(`${colors.green}✓ SUCCESS${colors.reset} (${duration}ms): ${processed.message}`);
        successCount++;
      } else {
        console.log(`${colors.red}✗ FAILED${colors.reset}: ${processed.message}`);
        failureCount++;
      }
    } catch (error) {
      console.log(`${colors.red}✗ ERROR${colors.reset}: ${error.message}`);
      failureCount++;
    }
    
    console.log();
  }
  
  // Summary
  console.log(`${colors.bright}Summary${colors.reset}`);
  console.log('-------');
  console.log(`${colors.green}Passed: ${successCount}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failureCount}${colors.reset}`);
  
  if (failureCount > 0) {
    console.log(`\n${colors.yellow}⚠ Some tests failed. Check your credentials in .env file.${colors.reset}`);
  } else {
    console.log(`\n${colors.green}✓ All tests passed! Your MCP server is working correctly.${colors.reset}`);
  }
  
  // Additional info
  console.log(`\n${colors.bright}Next Steps:${colors.reset}`);
  console.log('1. Try specific content IDs: content_get with your content IDs');
  console.log('2. Test write operations carefully: content_create, content_update');
  console.log('3. Configure Claude Desktop to use this server');
  console.log('\nRun with LOG_LEVEL=debug for detailed logs:');
  console.log('  LOG_LEVEL=debug node quick-test.js');
}

// Check if dist/index.js exists
import { existsSync } from 'fs';

if (!existsSync(serverPath)) {
  console.error(`${colors.red}Error: Server not built. Run 'npm run build' first.${colors.reset}`);
  process.exit(1);
}

// Check for .env file
if (!existsSync(path.join(__dirname, '.env'))) {
  console.error(`${colors.yellow}Warning: No .env file found. Using default/environment variables.${colors.reset}`);
}

runTests().catch(error => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});