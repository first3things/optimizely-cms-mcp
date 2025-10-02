import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Config } from './config.js';
import { ToolRegistry } from './tools/tool-registry.js';

// Import new tool implementations
import { HealthCheckTool } from './tools/implementations/health-tool.js';
import { DiscoverTool } from './tools/implementations/discover-tool.js';

// TODO: Import more tools as they're converted
// import { AnalyzeTool } from './tools/implementations/analyze-tool.js';
// import { SearchTool } from './tools/implementations/search-tool.js';
// import { LocateTool } from './tools/implementations/locate-tool.js';
// import { RetrieveTool } from './tools/implementations/retrieve-tool.js';
// import { CreateTool } from './tools/implementations/create-tool.js';
// import { UpdateTool } from './tools/implementations/update-tool.js';
// import { ManageTool } from './tools/implementations/manage-tool.js';
// import { HelpTool } from './tools/implementations/help-tool.js';

export async function registerAllTools(server: Server, config: Config): Promise<void> {
  // Create tool registry
  const registry = new ToolRegistry(config);
  
  // Register Phase 2 tools
  registry.register(new HealthCheckTool());
  registry.register(new DiscoverTool());
  
  // TODO: Register additional tools as they're implemented
  // registry.register(new AnalyzeTool());
  
  // TODO: During transition, also register legacy tools from existing register.ts
  // This allows gradual migration
  
  // Set up server with registered tools
  registry.setupServer(server);
}