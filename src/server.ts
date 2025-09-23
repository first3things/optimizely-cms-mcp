import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getConfig, type Config } from './config.js';
import { getLogger } from './utils/logger.js';
import { registerAllTools } from './register.js';

export async function createServer(config: Config): Promise<Server> {
  const logger = getLogger();
  logger.info(`Starting ${config.server.name} v${config.server.version}`);

  // Create MCP server
  const server = new Server({
    name: config.server.name,
    version: config.server.version,
    capabilities: {
      tools: {}
    }
  });

  // Register all tools
  await registerAllTools(server, config);

  logger.info('Server initialized successfully');
  return server;
}

export function createTransport(transportType: string) {
  switch (transportType) {
    case 'stdio':
      return new StdioServerTransport();
    default:
      throw new Error(`Unsupported transport: ${transportType}`);
  }
}

export async function startServer(): Promise<void> {
  const logger = getLogger();
  
  try {
    // Load configuration
    const config = getConfig();
    
    // Create server
    const server = await createServer(config);
    
    // Create transport
    const transport = createTransport(config.server.transport);
    
    // Start server
    await server.connect(transport);
    
    logger.info(`Server running with ${config.server.transport} transport`);
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down server...');
      await server.close();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info('Shutting down server...');
      await server.close();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}