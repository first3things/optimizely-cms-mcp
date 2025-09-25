# Optimizely MCP Test Scripts Guide

## Overview

This folder contains organized test scripts for the Optimizely MCP Server. Tests are divided into two main categories:

1. **Graph API Tests** - For Optimizely GraphQL API
2. **CMA Tests** - For Content Management API

## Available Test Commands

### Quick Tests
```bash
# Quick connectivity check for both APIs
npm run test:quick

# Run all tests
npm run test:all
```

### Graph API Tests
```bash
# Run Graph API tests
npm run test:graph

# Run with debug output
npm run test:graph:debug
```

### Content Management API Tests
```bash
# Run CMA tests
npm run test:cma

# Run with debug output
npm run test:cma:debug
```

### Debugging
```bash
# Run all tests with debug output
npm run test:debug

# Check environment variables
npm run check:env
```

## What Each Test Does

### Graph API Tests (`test-graph-api.js`)
1. **Basic Connectivity** - Verifies GraphQL endpoint is reachable
2. **Content Type Discovery** - Lists available content types
3. **Content Search** - Tests search functionality
4. **Schema Introspection** - Explores available GraphQL schema

### CMA Tests (`test-cma-api.js`)
1. **Authentication** - Tests OAuth2 authentication
2. **Content Types** - Lists available content types
3. **Experimental Endpoints** - Checks which endpoints are available
4. **API Capabilities** - Summary of what's working

### Quick Test (`test-quick.js`)
- Fast connectivity check for both APIs
- Shows operational status at a glance

## Debug Mode

All tests support debug mode which shows:
- Detailed request/response information
- Full error messages and stack traces
- API endpoint details
- Authentication information (sanitized)

## Windows Compatibility

All test scripts work on Windows PowerShell. The debug commands automatically handle environment variables correctly for Windows.

## Test Output

Tests use colored output for clarity:
- ✅ Green - Test passed
- ❌ Red - Test failed
- ⚠️  Yellow - Warning or limitation
- ℹ️  Blue - Information
- 🔍 Cyan - Debug information (in debug mode)

## Known Limitations

The tests will report these known limitations:
- Preview3 API has limited functionality
- Content CRUD operations are not available
- Only content type discovery is fully functional

## Troubleshooting

1. **Authentication Errors**
   - Run `npm run check:env` to verify credentials
   - Check that all required environment variables are set

2. **Connection Errors**
   - Verify network connectivity
   - Check firewall settings
   - Ensure API endpoints are correct

3. **404 Errors on CMA**
   - This is expected for preview3 API
   - Content management requires different API access

## Adding New Tests

To add a new test:
1. Follow the pattern in existing test files
2. Use the logging utilities for consistent output
3. Support both normal and debug modes
4. Update this guide with the new test