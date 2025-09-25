# Optimizely MCP Test Scripts

Clean, organized test scripts for the Optimizely MCP server.

## Available Commands

### Quick Testing
```bash
npm run test:quick      # Fast connectivity check
npm run test:all        # Run all test suites
```

### API-Specific Tests
```bash
# Graph API
npm run test:graph      # Run Graph API tests
npm run test:graph:debug # With debug output

# Content Management API  
npm run test:cma        # Run CMA tests
npm run test:cma:debug  # With debug output
```

### Environment Check
```bash
npm run check:env       # Validate environment variables
```

### Debug All Tests
```bash
npm run test:debug      # Run all tests with debug output
```

## Test Files

- `test-quick.js` - Fast connectivity check for both APIs
- `test-graph-api.js` - Comprehensive Graph API testing
- `test-cma-api.js` - Comprehensive CMA testing
- `test-all.js` - Runs all test suites
- `debug-helpers.js` - Debug utilities (Windows compatible)
- `diagnostics/check-credentials.mjs` - Environment validation

## Prerequisites

1. Build the project: `npm run build`
2. Configure `.env` file with API credentials
3. Have valid Optimizely API keys

## See Also

- [TEST_GUIDE.md](./TEST_GUIDE.md) - Detailed testing documentation