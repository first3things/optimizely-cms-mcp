# Scripts

This directory contains utility scripts for testing and managing the Optimizely MCP Server.

## quick-test.js

A comprehensive test script that validates your MCP server installation and API connections.

### Usage:
```bash
npm run test:tools        # Run the test
npm run test:tools:debug  # Run with debug logging
```

This script will:
- Test connectivity to both GraphQL and CMA APIs
- Run a health check
- List content types
- Perform a content search
- Show colored pass/fail results

## testing/

This subdirectory contains temporary test scripts used during development and debugging. These scripts are excluded from version control and can be safely deleted.

### Note:
Before running tests, ensure you have:
1. Built the project: `npm run build`
2. Created a `.env` file with valid API credentials
3. Valid API keys from your Optimizely instance