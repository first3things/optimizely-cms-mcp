import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OptimizelyGraphClient } from '../../src/clients/graph-client.js';
import { GraphConfig } from '../../src/types/config.js';

// Mock fetch
global.fetch = vi.fn();

describe('OptimizelyGraphClient', () => {
  const mockConfig: GraphConfig = {
    endpoint: 'https://test.optimizely.com/graphql',
    auth: {
      method: 'single_key',
      singleKey: 'test-key'
    },
    timeout: 30000,
    maxRetries: 3
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authentication', () => {
    it('should set correct headers for single_key auth', async () => {
      const client = new OptimizelyGraphClient(mockConfig);
      
      const mockResponse = new Response(JSON.stringify({ data: { test: 'result' } }), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' })
      });
      (global.fetch as any).mockResolvedValueOnce(mockResponse);

      await client.query('{ test }');

      expect(global.fetch).toHaveBeenCalled();
      
      const callArgs = (global.fetch as any).mock.calls[0];
      expect(callArgs[0].toString()).toBe(mockConfig.endpoint);
      expect(callArgs[1].headers.get('Authorization')).toBe('Bearer test-key');
      expect(callArgs[1].headers.get('Content-Type')).toBe('application/json');
    });

    it('should set correct headers for basic auth', async () => {
      const basicAuthConfig: GraphConfig = {
        ...mockConfig,
        auth: {
          method: 'basic',
          username: 'user',
          password: 'pass'
        }
      };

      const client = new OptimizelyGraphClient(basicAuthConfig);
      
      const mockResponse = new Response(JSON.stringify({ data: { test: 'result' } }), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' })
      });
      (global.fetch as any).mockResolvedValueOnce(mockResponse);

      await client.query('{ test }');

      const expectedAuth = Buffer.from('user:pass').toString('base64');
      expect(global.fetch).toHaveBeenCalled();
      
      const callArgs = (global.fetch as any).mock.calls[0];
      expect(callArgs[0].toString()).toBe(mockConfig.endpoint);
      expect(callArgs[1].headers.get('Authorization')).toBe(`Basic ${expectedAuth}`);
    });
  });

  describe('query execution', () => {
    it('should execute query successfully', async () => {
      const client = new OptimizelyGraphClient(mockConfig);
      const mockResponse = { data: { content: { items: [] } } };
      
      const mockResponseData = new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' })
      });
      (global.fetch as any).mockResolvedValueOnce(mockResponseData);

      const result = await client.query('{ content { items { name } } }');
      
      expect(result).toEqual(mockResponse.data);
    });

    it('should handle API errors', async () => {
      const client = new OptimizelyGraphClient(mockConfig);
      
      const mockErrorResponse = new Response('Invalid API key', {
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers({ 'content-type': 'text/plain' })
      });
      (global.fetch as any).mockResolvedValueOnce(mockErrorResponse);

      await expect(client.query('{ test }')).rejects.toThrow('GraphQL request failed');
    });
  });

  describe('connection test', () => {
    it('should return true for successful connection', async () => {
      const client = new OptimizelyGraphClient(mockConfig);
      
      const mockConnectionResponse = new Response(JSON.stringify({ data: { __typename: 'Query' } }), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' })
      });
      (global.fetch as any).mockResolvedValueOnce(mockConnectionResponse);

      const result = await client.testConnection();
      expect(result).toBe(true);
    });

    it('should return false for failed connection', async () => {
      const client = new OptimizelyGraphClient(mockConfig);
      
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      const result = await client.testConnection();
      expect(result).toBe(false);
    });
  });
});