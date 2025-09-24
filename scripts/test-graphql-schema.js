#\!/usr/bin/env node
import { config } from 'dotenv';
import https from 'https';

config();

const introspectionQuery = {
  query: `
    query IntrospectionQuery {
      __schema {
        queryType {
          name
          fields {
            name
            description
          }
        }
      }
    }
  `
};

const postData = JSON.stringify(introspectionQuery);

const options = {
  hostname: 'cg.optimizely.com',
  port: 443,
  path: '/content/v2',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData),
    'Authorization': `epi-single ${process.env.GRAPH_SINGLE_KEY}`,
    'User-Agent': 'optimizely-mcp-test/1.0'
  }
};

const req = https.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    if (res.statusCode === 200) {
      const response = JSON.parse(data);
      console.log('Available query fields:');
      console.log('======================');
      response.data.__schema.queryType.fields.forEach(field => {
        console.log(`- ${field.name}: ${field.description || 'No description'}`);
      });
    } else {
      console.error('Error:', res.statusCode, data);
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});

req.write(postData);
req.end();
EOF < /dev/null
