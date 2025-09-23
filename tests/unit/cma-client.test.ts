import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OptimizelyContentClient } from '../../src/clients/cma-client.js';
import { CMAConfig } from '../../src/types/config.js';

// Mock fetch
global.fetch = vi.fn();

describe('OptimizelyContentClient', () => {
  const mockConfig: CMAConfig = {
    baseUrl: 'https://test.optimizely.com/api',
    clientId: 'test-client',
    clientSecret: 'test-secret',
    grantType: 'client_credentials',
    scope: 'test-scope',
    timeout: 30000,
    maxRetries: 3
  };

  let client: OptimizelyContentClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new OptimizelyContentClient(mockConfig);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('authentication', () => {
    it('should authenticate with OAuth2', async () => {
      const mockTokenResponse = new Response(JSON.stringify({
        access_token: 'test-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'test-scope'
      }), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' })
      });

      const mockContentResponse = new Response(JSON.stringify({
        contentLink: { id: 123 },
        name: 'Test Content'
      }), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' })
      });

      (global.fetch as any)
        .mockResolvedValueOnce(mockTokenResponse)
        .mockResolvedValueOnce(mockContentResponse);

      const result = await client.get('/content/123');

      // Check token request
      expect(global.fetch).toHaveBeenCalled();
      const tokenCall = (global.fetch as any).mock.calls[0];
      expect(tokenCall[0]).toBe(`${mockConfig.baseUrl}/token`);
      expect(tokenCall[1].method).toBe('POST');
      const tokenBody = tokenCall[1].body;
      expect(tokenBody.get('client_id')).toBe('test-client');
      expect(tokenBody.get('client_secret')).toBe('test-secret');
      expect(tokenBody.get('grant_type')).toBe('client_credentials');
      expect(tokenBody.get('scope')).toBe('test-scope');

      // Check content request with token
      const contentCall = (global.fetch as any).mock.calls[1];
      expect(contentCall[0]).toBe(`${mockConfig.baseUrl}/content/123`);
      expect(contentCall[1].method).toBe('GET');
      expect(contentCall[1].headers.Authorization).toBe('Bearer test-token');
    });

    it('should refresh token when expired', async () => {
      vi.useFakeTimers();
      
      (global.fetch as any)
        .mockResolvedValueOnce(new Response(JSON.stringify({
          access_token: 'first-token',
          token_type: 'Bearer',
          expires_in: 60, // 1 minute
          scope: 'test-scope'
        }), {
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' })
        })) // First auth
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 123 }), {
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' })
        })) // First request
        .mockResolvedValueOnce(new Response(JSON.stringify({
          access_token: 'second-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'test-scope'
        }), {
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' })
        })) // Second auth
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 456 }), {
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' })
        })); // Second request

      // First request
      await client.get('/content/123');
      
      // Advance time to expire token
      vi.advanceTimersByTime(61000); // 61 seconds
      
      // Second request should re-authenticate
      await client.get('/content/456');
      
      // Should have called auth twice
      expect(global.fetch).toHaveBeenCalledTimes(4); // 2 auth + 2 content requests
      const firstTokenCall = (global.fetch as any).mock.calls[0];
      const secondTokenCall = (global.fetch as any).mock.calls[2];
      expect(firstTokenCall[0]).toBe(`${mockConfig.baseUrl}/token`);
      expect(secondTokenCall[0]).toBe(`${mockConfig.baseUrl}/token`);
    });
  });

  describe('request methods', () => {
    beforeEach(async () => {
      // Mock authentication
      const mockTokenResponse = new Response(JSON.stringify({
        access_token: 'test-token',
        token_type: 'Bearer',
        expires_in: 3600
      }), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' })
      });
      
      (global.fetch as any).mockResolvedValueOnce(mockTokenResponse);
    });

    it('should handle GET requests', async () => {
      const mockResponse = new Response(JSON.stringify({ id: 123 }), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' })
      });
      
      (global.fetch as any).mockResolvedValueOnce(mockResponse);
      
      const result = await client.get('/content/123', { language: 'en' });
      
      expect(result).toEqual({ id: 123 });
      expect(global.fetch).toHaveBeenLastCalledWith(
        `${mockConfig.baseUrl}/content/123?language=en`,
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should handle POST requests', async () => {
      const mockResponse = new Response(JSON.stringify({ id: 456 }), {
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' })
      });
      
      (global.fetch as any).mockResolvedValueOnce(mockResponse);
      
      const body = { name: 'New Content' };
      const result = await client.post('/content', body);
      
      expect(result).toEqual({ id: 456 });
      expect(global.fetch).toHaveBeenLastCalledWith(
        `${mockConfig.baseUrl}/content`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body)
        })
      );
    });

    it('should handle 404 errors', async () => {
      const mockResponse = new Response('Not Found', {
        status: 404,
        statusText: 'Not Found'
      });
      
      (global.fetch as any).mockResolvedValueOnce(mockResponse);
      
      await expect(client.get('/content/999')).rejects.toThrow('Resource not found');
    });
  });

  describe('connection test', () => {
    it('should return true for successful connection', async () => {
      // Mock auth and content types request
      const mockTokenResponse = new Response(JSON.stringify({
        access_token: 'test-token',
        token_type: 'Bearer',
        expires_in: 3600
      }), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' })
      });
      
      const mockTypesResponse = new Response(JSON.stringify([
        { id: 'Page', name: 'Page' }
      ]), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' })
      });
      
      (global.fetch as any)
        .mockResolvedValueOnce(mockTokenResponse)
        .mockResolvedValueOnce(mockTypesResponse);
      
      const result = await client.testConnection();
      expect(result).toBe(true);
    });

    it('should return false for failed connection', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));
      
      const result = await client.testConnection();
      expect(result).toBe(false);
    });
  });
});