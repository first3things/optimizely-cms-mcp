# Scripts Directory

This directory contains debugging utilities and testing tools for the Optimizely MCP Server.

## Overview

These scripts are **not** unit tests (which live in `/tests/`). Instead, they are interactive debugging tools and utilities for:
- Testing API connectivity
- Validating credentials
- Debugging authentication issues
- Manual testing of MCP tools

## Available Scripts

See [TESTING_SCRIPTS.md](TESTING_SCRIPTS.md) for detailed documentation of each script.

### Quick Reference

```bash
# Test MCP tools
npm run test:tools

# Check credentials
npm run check:credentials

# Debug GraphQL connection
npm run debug:graph

# Validate API key
npm run validate:key

# Find GraphQL endpoint
npm run find:endpoint
```

## Prerequisites

1. Build the project: `npm run build`
2. Configure `.env` file with valid API credentials
3. Have valid API keys from your Optimizely instance