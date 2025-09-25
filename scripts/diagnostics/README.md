# Diagnostics Scripts

Environment and configuration validation tool.

## check-credentials.mjs

Validates that all required environment variables are set correctly.

```bash
npm run check:env
```

### What it checks:
- All required environment variables are present
- API endpoints are properly formatted
- Credentials are not empty
- OAuth2 authentication for CMA
- Configuration validity for both APIs

### Example Output
```
✅ GRAPH_ENDPOINT: Set
✅ GRAPH_SINGLE_KEY: Set (32 chars)
✅ CMA_BASE_URL: Set
✅ CMA_CLIENT_ID: Set (32 chars)
✅ CMA_CLIENT_SECRET: Set (hidden)

Testing CMA authentication...
✅ OAuth2 authentication successful

All credentials are properly configured!
```

### When to use:
1. **After initial setup** - Verify credentials are correct
2. **When tools fail** - Check if APIs are accessible
3. **After credential changes** - Ensure new keys work
4. **For troubleshooting** - Get detailed error information