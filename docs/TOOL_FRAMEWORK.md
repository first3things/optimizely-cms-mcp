# Base Tool Framework

The base tool framework provides a consistent pattern for implementing MCP tools with built-in validation, error handling, and logging.

## Creating a New Tool

To create a new tool, extend the `BaseTool` class:

```typescript
import { z } from 'zod';
import { BaseTool, ToolContext } from '../base-tool.js';

// Define input schema using Zod
const myToolSchema = z.object({
  query: z.string().describe('The search query'),
  limit: z.number().optional().default(10).describe('Maximum results')
});

type MyToolInput = z.infer<typeof myToolSchema>;

interface MyToolOutput {
  results: string[];
  count: number;
}

export class MyTool extends BaseTool<MyToolInput, MyToolOutput> {
  protected readonly name = 'my-tool';
  protected readonly description = 'Description of what my tool does';
  protected readonly inputSchema = myToolSchema;
  
  protected async run(input: MyToolInput, context: ToolContext): Promise<MyToolOutput> {
    const { config, logger } = context;
    
    // Report progress
    this.reportProgress('Starting search...', 0);
    
    // Your tool logic here
    const results = await this.performSearch(input.query, input.limit);
    
    this.reportProgress('Search complete', 100);
    
    return {
      results,
      count: results.length
    };
  }
  
  private async performSearch(query: string, limit: number): Promise<string[]> {
    // Implementation details
    return [];
  }
}
```

## Features Provided by BaseTool

### 1. Automatic Input Validation
- Uses Zod schemas for type-safe validation
- Automatically converts to JSON Schema for MCP
- Provides helpful validation error messages

### 2. Consistent Error Handling
- Catches and formats all errors consistently
- Integrates with the centralized error handling system
- Provides proper MCP error responses

### 3. Built-in Logging
- Logs tool execution start/end with timing
- Tracks success/failure metrics
- Sanitizes sensitive data in logs

### 4. Progress Reporting
- Use `this.reportProgress(message, percentage)` to report progress
- Automatically logged with proper context

### 5. Cache Key Generation
- Use `this.getCacheKey(...)` to generate consistent cache keys
- Automatically prefixed with tool name

## Registering Tools

Tools are registered using the `ToolRegistry`:

```typescript
import { ToolRegistry } from './tools/tool-registry.js';
import { HealthCheckTool } from './tools/implementations/health-tool.js';
import { DiscoverTool } from './tools/implementations/discover-tool.js';

// Create registry
const registry = new ToolRegistry(config);

// Register individual tools
registry.register(new HealthCheckTool());
registry.register(new DiscoverTool());

// Or register multiple at once
registry.registerAll([
  new HealthCheckTool(),
  new DiscoverTool(),
  new SearchTool()
]);

// Set up with MCP server
registry.setupServer(server);
```

## Tool Context

Every tool receives a context object with:
- `config`: The server configuration
- `logger`: Configured logger instance

## Best Practices

1. **Keep tool logic in the `run` method**: All business logic should be in the run method, not the constructor
2. **Use descriptive schema descriptions**: These appear in the MCP tool documentation
3. **Report progress for long operations**: Use `reportProgress` for operations over 1 second
4. **Handle errors gracefully**: Throw `OptimizelyError` subclasses for known errors
5. **Use caching when appropriate**: Cache expensive operations using the cache utilities
6. **Keep tools focused**: Each tool should do one thing well

## Migration Guide

To migrate existing tools to the new framework:

1. Create a new class extending `BaseTool`
2. Move the tool name and description to class properties
3. Convert the input schema to Zod
4. Move the handler logic to the `run` method
5. Replace direct error handling with throws
6. Remove manual logging (it's automatic now)

Example migration:

```typescript
// Old style
const myTool = {
  name: 'my-tool',
  description: 'Does something',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' }
    }
  }
};

handlers.set('my-tool', async (params, context) => {
  try {
    // validation
    // logic
    // formatting
  } catch (error) {
    // error handling
  }
});

// New style
class MyTool extends BaseTool<{query: string}, any> {
  protected readonly name = 'my-tool';
  protected readonly description = 'Does something';
  protected readonly inputSchema = z.object({
    query: z.string()
  });
  
  protected async run(input, context) {
    // just the logic - validation and error handling are automatic
  }
}
```

## Testing Tools

Tools can be easily unit tested:

```typescript
import { MyTool } from './my-tool.js';

describe('MyTool', () => {
  const mockContext = {
    config: getTestConfig(),
    logger: getTestLogger()
  };
  
  it('should handle valid input', async () => {
    const tool = new MyTool();
    const result = await tool.execute(
      { query: 'test' },
      mockContext
    );
    
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('results');
  });
});
```