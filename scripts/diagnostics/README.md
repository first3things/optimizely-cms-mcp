# Diagnostic Scripts

These scripts help diagnose and troubleshoot connection issues with the Optimizely MCP Server.

## check-credentials.mjs

Validates your API credentials and tests authentication.

### Usage:
```bash
npm run check:credentials
```

### Features:
- Shows loaded environment variables (safely masked)
- Tests OAuth2 authentication for CMA
- Generates curl commands for manual testing
- Provides clear error messages if authentication fails

## test-connection.mjs

Tests actual API connections through the MCP server.

### Usage:
```bash
npm run test:connection
```

### Features:
- Tests health check functionality
- Verifies API connectivity
- Tests content retrieval
- Shows detailed error messages

## When to use these scripts:

1. **After initial setup** - Verify your credentials are correct
2. **When tools aren't returning content** - Check if APIs are accessible
3. **After credential changes** - Ensure new keys work correctly
4. **For troubleshooting** - Get detailed error information

These diagnostic tools are part of the solution and should be committed to help future users troubleshoot issues.