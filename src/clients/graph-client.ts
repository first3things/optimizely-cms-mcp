import { GraphQLClient } from 'graphql-request';
import { getIntrospectionQuery, IntrospectionQuery } from 'graphql';
import { GraphConfig, AuthConfig } from '../types/config.js';
import { generateHMACHeaders } from './auth/hmac.js';
import { AuthenticationError, APIError, TimeoutError } from '../utils/errors.js';
import { withRetry } from '../utils/errors.js';
import { getLogger, logAPIRequest, logAPIResponse } from '../utils/logger.js';
import { withCache } from '../utils/cache.js';
import { handleGraphQLError } from '../utils/graphql-error-handler.js';

export class OptimizelyGraphClient {
  private endpoint: string;
  private auth: AuthConfig;
  private client: GraphQLClient;
  private logger = getLogger();
  private timeout: number;
  private maxRetries: number;

  constructor(config: GraphConfig) {
    this.endpoint = config.endpoint;
    this.auth = config.auth;
    this.timeout = config.timeout || 30000;
    this.maxRetries = config.maxRetries || 3;
    this.client = this.createClient();
  }

  private createClient(): GraphQLClient {
    const headers = this.getAuthHeaders('POST', new URL(this.endpoint).pathname);
    
    return new GraphQLClient(this.endpoint, {
      headers,
      errorPolicy: 'all',
      fetch: this.createFetch()
    });
  }

  private createFetch() {
    const originalFetch = fetch;
    
    return async (url: string | URL | Request, init?: RequestInit) => {
      const start = Date.now();
      const method = init?.method || 'GET';
      const urlString = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      
      logAPIRequest(method, urlString, {
        headers: init?.headers as Record<string, string>,
        body: init?.body
      });
      
      try {
        const response = await originalFetch(url, init);
        const duration = Date.now() - start;
        
        logAPIResponse(urlString, response.status, duration);
        
        if (!response.ok) {
          const errorBody = await response.text();
          throw new APIError(
            `GraphQL request failed: ${response.statusText}`,
            response.status,
            { body: errorBody }
          );
        }
        
        return response;
      } catch (error) {
        const duration = Date.now() - start;
        
        if (error instanceof TypeError && error.message.includes('fetch')) {
          throw new TimeoutError(`Request timeout after ${duration}ms`, this.timeout);
        }
        
        throw error;
      }
    };
  }

  private getAuthHeaders(method: string = 'POST', path: string = '/', body?: string): Record<string, string> {
    switch (this.auth.method) {
      case 'single_key':
        if (!this.auth.singleKey) {
          throw new AuthenticationError('Single key authentication requires singleKey');
        }
        return {
          'Authorization': `epi-single ${this.auth.singleKey}`,
          'Content-Type': 'application/json'
        };
      
      case 'hmac':
        if (!this.auth.appKey || !this.auth.secret) {
          throw new AuthenticationError('HMAC authentication requires appKey and secret');
        }
        return generateHMACHeaders(
          { appKey: this.auth.appKey, secret: this.auth.secret },
          method,
          path,
          body
        );
      
      case 'basic':
        if (!this.auth.username || !this.auth.password) {
          throw new AuthenticationError('Basic authentication requires username and password');
        }
        const credentials = Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64');
        return {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/json'
        };
      
      case 'bearer':
        if (!this.auth.token) {
          throw new AuthenticationError('Bearer authentication requires token');
        }
        return {
          'Authorization': `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json'
        };
      
      case 'oidc':
        if (!this.auth.token) {
          throw new AuthenticationError('OIDC authentication requires token');
        }
        return {
          'Authorization': `Bearer ${this.auth.token}`,
          'Content-Type': 'application/json'
        };
      
      default:
        throw new AuthenticationError(`Unsupported authentication method: ${this.auth.method}`);
    }
  }

  async query<T>(
    query: string,
    variables?: Record<string, any>,
    options?: {
      cacheKey?: string;
      cacheTtl?: number;
      operationName?: string;
    }
  ): Promise<T> {
    const executeQuery = async () => {
      return await withRetry(
        async () => {
          this.logger.debug('Executing GraphQL query', {
            operationName: options?.operationName,
            variables,
            queryType: typeof query,
            queryLength: query?.length
          });
          
          // For HMAC auth, we need to update headers for each request
          if (this.auth.method === 'hmac') {
            const body = JSON.stringify({ query, variables });
            const headers = this.getAuthHeaders('POST', new URL(this.endpoint).pathname, body);
            this.client.setHeaders(headers);
          }
          
          try {
            return await this.client.request<T>(query, variables);
          } catch (requestError) {
            // Handle GraphQL-specific errors with enhanced error messages
            handleGraphQLError(requestError, query, variables);
          }
        },
        { maxRetries: this.maxRetries }
      );
    };

    // Use cache if cache key is provided
    if (options?.cacheKey) {
      return await withCache(
        options.cacheKey,
        executeQuery,
        options.cacheTtl
      );
    }

    return await executeQuery();
  }

  async introspect(): Promise<IntrospectionQuery> {
    return await this.query<IntrospectionQuery>(
      getIntrospectionQuery(),
      undefined,
      { 
        cacheKey: 'graphql:introspection',
        cacheTtl: 3600 // Cache for 1 hour
      }
    );
  }

  async testConnection(): Promise<boolean> {
    try {
      // Simple query to test connection
      const testQuery = `
        query TestConnection {
          __typename
        }
      `;
      
      await this.query(testQuery);
      return true;
    } catch (error) {
      this.logger.error('GraphQL connection test failed', error);
      return false;
    }
  }

  updateAuth(auth: AuthConfig): void {
    this.auth = auth;
    this.client = this.createClient();
  }
}