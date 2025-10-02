import { getLogger } from '../utils/logger.js';
import { withRetry, OptimizelyError, AuthenticationError, APIError, TimeoutError } from '../utils/errors.js';
import { withCache } from '../utils/cache.js';
import type { Logger } from '../types/logger.js';

export interface BaseClientConfig {
  baseUrl: string;
  timeout?: number;
  maxRetries?: number;
  cacheTtl?: number;
}

export abstract class BaseAPIClient {
  protected logger: Logger;
  protected config: BaseClientConfig;
  
  constructor(config: BaseClientConfig) {
    this.config = config;
    this.logger = getLogger();
  }
  
  /**
   * Get authorization headers for the request
   */
  protected abstract getAuthHeaders(): Promise<Record<string, string>>;
  
  /**
   * Make an authenticated request with retry logic
   */
  protected async request<T>(
    path: string,
    options: RequestInit = {},
    retryOptions?: Parameters<typeof withRetry>[1]
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    
    return withRetry(
      async () => {
        const authHeaders = await this.getAuthHeaders();
        
        const requestOptions: RequestInit = {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
            ...options.headers
          }
        };
        
        // Add timeout if configured
        if (this.config.timeout) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
          requestOptions.signal = controller.signal;
          
          try {
            const response = await this.makeRequest(url, requestOptions);
            clearTimeout(timeoutId);
            return response;
          } catch (error: any) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
              throw new TimeoutError(`Request timed out after ${this.config.timeout}ms`, this.config.timeout);
            }
            throw error;
          }
        }
        
        return this.makeRequest(url, requestOptions);
      },
      retryOptions || { maxRetries: this.config.maxRetries || 3 }
    );
  }
  
  /**
   * Make the actual HTTP request and handle response
   */
  private async makeRequest<T>(url: string, options: RequestInit): Promise<T> {
    this.logRequest(url, options);
    
    const response = await fetch(url, options);
    
    this.logResponse(url, response);
    
    if (!response.ok) {
      await this.handleErrorResponse(response);
    }
    
    // Handle empty responses
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return {} as T;
    }
    
    return response.json();
  }
  
  /**
   * Handle error responses
   */
  protected async handleErrorResponse(response: Response): Promise<never> {
    const contentType = response.headers.get('content-type');
    let errorBody: any = {};
    
    if (contentType?.includes('application/json')) {
      try {
        errorBody = await response.json();
      } catch {
        // Failed to parse JSON error
      }
    } else {
      errorBody.message = await response.text();
    }
    
    const message = errorBody.message || errorBody.error || response.statusText;
    
    switch (response.status) {
      case 401:
        throw new AuthenticationError(message, errorBody);
      case 403:
        throw new AuthenticationError(`Forbidden: ${message}`, errorBody);
      case 404:
        throw new APIError(`Not found: ${message}`, 404, errorBody);
      case 429:
        const retryAfter = response.headers.get('retry-after');
        throw new APIError(
          `Rate limited: ${message}`,
          429,
          { ...errorBody, retryAfter: retryAfter ? parseInt(retryAfter) : undefined }
        );
      default:
        throw new APIError(
          `API error (${response.status}): ${message}`,
          response.status,
          errorBody
        );
    }
  }
  
  /**
   * Log request details
   */
  protected logRequest(url: string, options: RequestInit): void {
    this.logger.debug('API Request:', {
      url,
      method: options.method || 'GET',
      headers: this.sanitizeHeaders(options.headers as Record<string, string>)
    });
    
    if (options.body) {
      this.logger.debug('Request Body:', options.body);
    }
  }
  
  /**
   * Log response details
   */
  protected logResponse(url: string, response: Response): void {
    this.logger.debug('API Response:', {
      url,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
    });
  }
  
  /**
   * Sanitize headers for logging (remove sensitive data)
   */
  protected sanitizeHeaders(headers?: Record<string, string>): Record<string, string> {
    if (!headers) return {};
    
    const sanitized = { ...headers };
    const sensitiveKeys = ['authorization', 'x-api-key', 'x-secret-key', 'cookie'];
    
    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.includes(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }
  
  /**
   * Make a cached request
   */
  protected async cachedRequest<T>(
    cacheKey: string,
    requestFn: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    return withCache(
      cacheKey,
      requestFn,
      ttl || this.config.cacheTtl
    );
  }
}