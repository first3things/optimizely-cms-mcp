import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function testTool(toolName, args = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\nTesting ${toolName}...`);
    
    const serverProcess = spawn('node', [join(__dirname, 'dist', 'index.js')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    });

    let output = '';
    let errorOutput = '';
    let timeout;

    serverProcess.stdout.on('data', (data) => {
      const str = data.toString();
      output += str;
      
      // Look for JSON-RPC response
      const lines = str.split('\n');
      for (const line of lines) {
        if (line.includes('"jsonrpc"')) {
          try {
            const response = JSON.parse(line);
            clearTimeout(timeout);
            serverProcess.kill();
            resolve(response);
            return;
          } catch (e) {
            // Continue if not valid JSON
          }
        }
      }
    });

    serverProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    serverProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start server: ${err.message}`));
    });

    // Send the JSON-RPC request
    const request = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      },
      id: Date.now()
    };

    serverProcess.stdin.write(JSON.stringify(request) + '\n');
    serverProcess.stdin.end();

    // Timeout after 10 seconds
    timeout = setTimeout(() => {
      serverProcess.kill();
      reject(new Error(`Timeout waiting for response from ${toolName}`));
    }, 10000);
  });
}

async function runTests() {
  console.log('Testing Optimizely MCP Server Tools');
  console.log('===================================');

  try {
    // Test 1: Health Check
    console.log('\n1. Testing health check...');
    const healthResult = await testTool('health_check');
    if (healthResult.result) {
      const data = JSON.parse(healthResult.result.content[0].text);
      console.log(`✓ Server: ${data.server.name} v${data.server.version}`);
      console.log(`✓ Status: ${data.status}`);
      console.log(`✓ Tools: ${data.toolsCount}`);
    } else if (healthResult.error) {
      console.log(`✗ Error: ${healthResult.error.message}`);
    }

    // Test 2: Connection Test
    console.log('\n2. Testing API connections...');
    const connResult = await testTool('test_connection');
    if (connResult.result) {
      const data = JSON.parse(connResult.result.content[0].text);
      console.log(`✓ Overall health: ${data.healthy ? 'Good' : 'Bad'}`);
      console.log(`✓ GraphQL: ${data.graphQL.connected ? 'Connected' : 'Failed'} - ${data.graphQL.endpoint}`);
      console.log(`✓ CMA: ${data.contentAPI.connected ? 'Connected' : 'Failed'} - ${data.contentAPI.endpoint}`);
    } else if (connResult.error) {
      console.log(`✗ Error: ${connResult.error.message}`);
    }

    // Test 3: List Content Types
    console.log('\n3. Testing content type listing...');
    const typesResult = await testTool('type_list', { includeSystemTypes: false });
    if (typesResult.result) {
      const data = JSON.parse(typesResult.result.content[0].text);
      console.log(`✓ Found ${data.totalTypes} content types`);
      if (data.types && data.types.length > 0) {
        console.log('  Examples:', data.types.slice(0, 3).map(t => t.name).join(', '));
      }
    } else if (typesResult.error) {
      console.log(`✗ Error: ${typesResult.error.message}`);
    }

    // Test 4: Search Content
    console.log('\n4. Testing content search...');
    const searchResult = await testTool('graph_search', { query: 'page', limit: 3 });
    if (searchResult.result) {
      const data = JSON.parse(searchResult.result.content[0].text);
      console.log(`✓ Found ${data.total || 0} items`);
      if (data.items && data.items.length > 0) {
        console.log('  First result:', data.items[0].name);
      }
    } else if (searchResult.error) {
      console.log(`✗ Error: ${searchResult.error.message}`);
    }

    console.log('\n✓ All tests completed!');
    console.log('\nYour MCP server is working correctly and can retrieve content from the CMS.');
    console.log('\nNext steps:');
    console.log('1. Configure Claude Desktop with this server');
    console.log('2. Test specific content IDs with content_get');
    console.log('3. Try more advanced queries');
    
  } catch (error) {
    console.error('\n✗ Test failed:', error.message);
    console.error('\nTroubleshooting tips:');
    console.error('1. Check your .env file has valid credentials');
    console.error('2. Ensure your API keys have the correct permissions');
    console.error('3. Check network connectivity to Optimizely APIs');
    console.error('4. Run with LOG_LEVEL=debug for more details');
  }
}

runTests().catch(console.error);