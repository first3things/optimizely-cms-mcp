import { config as loadEnv } from 'dotenv';
import { ConfigSchema, type Config, type GraphConfig, type CMAConfig, type AuthConfig } from './types/config.js';

// Load environment variables
loadEnv();

// Re-export Config type
export type { Config } from './types/config.js';

export function loadConfig(): Config {
  const rawConfig = {
    server: {
      name: process.env.SERVER_NAME,
      version: process.env.SERVER_VERSION,
      transport: process.env.TRANSPORT
    },
    graph: {
      endpoint: process.env.GRAPH_ENDPOINT,
      authMethod: process.env.GRAPH_AUTH_METHOD,
      credentials: {
        singleKey: process.env.GRAPH_SINGLE_KEY,
        appKey: process.env.GRAPH_APP_KEY,
        secret: process.env.GRAPH_SECRET,
        username: process.env.GRAPH_USERNAME,
        password: process.env.GRAPH_PASSWORD,
        token: process.env.GRAPH_TOKEN
      }
    },
    cma: {
      baseUrl: process.env.CMA_BASE_URL,
      clientId: process.env.CMA_CLIENT_ID,
      clientSecret: process.env.CMA_CLIENT_SECRET,
      grantType: process.env.CMA_GRANT_TYPE,
      scope: process.env.CMA_SCOPE,
      tokenEndpoint: process.env.CMA_TOKEN_ENDPOINT
    },
    options: {
      cacheTtl: process.env.CACHE_TTL ? parseInt(process.env.CACHE_TTL, 10) : undefined,
      maxRetries: process.env.MAX_RETRIES ? parseInt(process.env.MAX_RETRIES, 10) : undefined,
      timeout: process.env.TIMEOUT ? parseInt(process.env.TIMEOUT, 10) : undefined,
      logLevel: process.env.LOG_LEVEL
    }
  };

  // Validate and parse configuration
  const result = ConfigSchema.safeParse(rawConfig);
  
  if (!result.success) {
    console.error('Configuration validation failed:', result.error.errors);
    throw new Error(`Invalid configuration: ${result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
  }

  return result.data;
}

export function getGraphConfig(config: Config): GraphConfig {
  const auth: AuthConfig = {
    method: config.graph.authMethod,
    ...config.graph.credentials
  };

  return {
    endpoint: config.graph.endpoint,
    auth,
    timeout: config.options.timeout,
    maxRetries: config.options.maxRetries
  };
}

export function getCMAConfig(config: Config): CMAConfig {
  return {
    baseUrl: config.cma.baseUrl,
    clientId: config.cma.clientId,
    clientSecret: config.cma.clientSecret,
    grantType: config.cma.grantType,
    scope: config.cma.scope,
    tokenEndpoint: config.cma.tokenEndpoint || `${config.cma.baseUrl}/token`,
    timeout: config.options.timeout,
    maxRetries: config.options.maxRetries
  };
}

// Singleton instance
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}