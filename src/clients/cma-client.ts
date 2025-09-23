import { CMAConfig } from '../types/config.js';
import { AuthenticationError, APIError, TimeoutError, NotFoundError, ValidationError } from '../utils/errors.js';
import { withRetry } from '../utils/errors.js';
import { getLogger, logAPIRequest, logAPIResponse } from '../utils/logger.js';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

interface APIResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

export class OptimizelyContentClient {
  private baseUrl: string;
  private clientId: string;
  private clientSecret: string;
  private grantType: string;
  private scope: string;
  private tokenEndpoint: string;
  private timeout: number;
  private maxRetries: number;
  private logger = getLogger();
  
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(config: CMAConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.grantType = config.grantType;
    this.scope = config.scope;
    this.tokenEndpoint = config.tokenEndpoint || `${this.baseUrl}/token`;
    this.timeout = config.timeout || 30000;
    this.maxRetries = config.maxRetries || 3;
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.accessToken || !this.tokenExpiry || new Date() >= this.tokenExpiry) {
      await this.authenticate();
    }
  }

  private async authenticate(): Promise<void> {
    this.logger.info('Authenticating with Content Management API');
    
    try {
      const response = await fetch(this.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: this.grantType,
          scope: this.scope
        }),
        signal: AbortSignal.timeout(this.timeout)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new AuthenticationError(`Authentication failed: ${response.statusText}`, {
          status: response.status,
          body: errorText
        });
      }

      const token = await response.json() as TokenResponse;
      this.accessToken = token.access_token;
      
      // Set expiry with 1 minute buffer
      const expiresIn = token.expires_in - 60;
      this.tokenExpiry = new Date(Date.now() + expiresIn * 1000);
      
      this.logger.info('Authentication successful', {
        tokenType: token.token_type,
        expiresIn: token.expires_in,
        scope: token.scope
      });
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      throw new AuthenticationError(`Failed to authenticate: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async request<T = any>(
    path: string,
    options: RequestInit = {}
  ): Promise<APIResponse<T>> {
    await this.ensureAuthenticated();
    
    const url = `${this.baseUrl}${path}`;
    const method = options.method || 'GET';
    
    // Log request
    logAPIRequest(method, url, {
      headers: options.headers as Record<string, string>,
      body: options.body
    });
    
    const executeRequest = async (): Promise<APIResponse<T>> => {
      const start = Date.now();
      
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...options.headers
          },
          signal: AbortSignal.timeout(this.timeout)
        });

        const duration = Date.now() - start;
        logAPIResponse(url, response.status, duration);

        // Handle specific status codes
        if (response.status === 401) {
          // Token might be expired, clear it and retry
          this.accessToken = null;
          this.tokenExpiry = null;
          throw new AuthenticationError('Token expired or invalid');
        }

        if (response.status === 404) {
          throw new NotFoundError(`Resource not found: ${path}`);
        }

        if (response.status === 400) {
          const errorData = await response.json().catch(() => ({}));
          throw new ValidationError('Validation failed', errorData);
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new APIError(
            `API request failed: ${response.statusText}`,
            response.status,
            { body: errorText, path }
          );
        }

        // Handle empty responses
        let data: T;
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          data = await response.json() as T;
        } else if (response.status === 204) {
          data = {} as T; // No content
        } else {
          data = await response.text() as any;
        }

        return {
          data,
          status: response.status,
          headers: response.headers
        };
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new TimeoutError(`Request timeout after ${this.timeout}ms`, this.timeout);
        }
        throw error;
      }
    };

    return await withRetry(executeRequest, { maxRetries: this.maxRetries });
  }

  async get<T = any>(path: string, params?: Record<string, any>): Promise<T> {
    const queryString = params ? `?${new URLSearchParams(params).toString()}` : '';
    const response = await this.request<T>(`${path}${queryString}`, {
      method: 'GET'
    });
    return response.data;
  }

  async post<T = any>(path: string, body: any): Promise<T> {
    const response = await this.request<T>(path, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    return response.data;
  }

  async put<T = any>(path: string, body: any): Promise<T> {
    const response = await this.request<T>(path, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
    return response.data;
  }

  async patch<T = any>(path: string, patches: any[]): Promise<T> {
    const response = await this.request<T>(path, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json-patch+json'
      },
      body: JSON.stringify(patches)
    });
    return response.data;
  }

  async delete<T = any>(path: string): Promise<T> {
    const response = await this.request<T>(path, {
      method: 'DELETE'
    });
    return response.data;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.ensureAuthenticated();
      // Try to get content types as a simple test
      await this.get('/contenttypes');
      return true;
    } catch (error) {
      this.logger.error('CMA connection test failed', error);
      return false;
    }
  }

  // Helper method to build content API paths
  getContentPath(contentId?: string, language?: string): string {
    let path = '/content';
    if (contentId) {
      path += `/${contentId}`;
    }
    if (language) {
      path += `?language=${language}`;
    }
    return path;
  }

  // Helper method to handle language branches
  getLanguagePath(contentId: string, language?: string): string {
    if (language) {
      return `/content/${contentId}/languages/${language}`;
    }
    return `/content/${contentId}/languages`;
  }

  // Helper method for version paths
  getVersionPath(contentId: string, version?: string, language?: string): string {
    let path = `/content/${contentId}/versions`;
    if (version) {
      path += `/${version}`;
    }
    if (language) {
      path += `?language=${language}`;
    }
    return path;
  }
}