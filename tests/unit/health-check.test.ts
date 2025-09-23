import { describe, it, expect, beforeEach } from 'vitest';
import { createServer } from '../../src/server.js';
import { Config } from '../../src/types/config.js';

describe('Health Check Tool', () => {
  let server: any;
  const mockConfig: Config = {
    server: {
      name: 'test-server',
      version: '1.0.0',
      transport: 'stdio'
    },
    graph: {
      endpoint: 'https://test.optimizely.com/graphql',
      authMethod: 'single_key',
      credentials: {
        singleKey: 'test-key'
      }
    },
    cma: {
      baseUrl: 'https://test.optimizely.com/api',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      grantType: 'client_credentials'
    },
    options: {
      cacheTtl: 300,
      maxRetries: 3,
      timeout: 30000,
      logLevel: 'info'
    }
  };

  beforeEach(async () => {
    server = await createServer(mockConfig);
  });

  it('should return healthy status', async () => {
    // This is a basic test to ensure the server initializes
    expect(server).toBeDefined();
    expect(server.registerCapabilities).toBeDefined();
  });
});