import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export class OptimizelyError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
    public details?: any
  ) {
    super(message);
    this.name = 'OptimizelyError';
  }
}

export class AuthenticationError extends OptimizelyError {
  constructor(message: string, details?: any) {
    super(message, 'AUTHENTICATION_ERROR', 401, details);
    this.name = 'AuthenticationError';
  }
}

export class APIError extends OptimizelyError {
  constructor(message: string, statusCode: number, details?: any) {
    super(message, 'API_ERROR', statusCode, details);
    this.name = 'APIError';
  }
}

export class ValidationError extends OptimizelyError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends OptimizelyError {
  constructor(message: string, details?: any) {
    super(message, 'NOT_FOUND', 404, details);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends OptimizelyError {
  constructor(message: string, retryAfter?: number) {
    super(message, 'RATE_LIMIT', 429, { retryAfter });
    this.name = 'RateLimitError';
  }
}

export class TimeoutError extends OptimizelyError {
  constructor(message: string, timeout: number) {
    super(message, 'TIMEOUT', 408, { timeout });
    this.name = 'TimeoutError';
  }
}

export function handleError(error: any): CallToolResult {
  console.error('Tool execution error:', error);

  if (error instanceof OptimizelyError) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: formatErrorMessage(error)
      }]
    };
  }

  // Handle fetch/network errors
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: `Network error: ${error.message}`
      }]
    };
  }

  // Handle GraphQL errors
  if (error.response?.errors) {
    const graphQLErrors = error.response.errors
      .map((e: any) => `- ${e.message}`)
      .join('\n');
    
    return {
      isError: true,
      content: [{
        type: 'text',
        text: `GraphQL errors:\n${graphQLErrors}`
      }]
    };
  }

  // Generic error
  return {
    isError: true,
    content: [{
      type: 'text',
      text: `Unexpected error: ${error.message || error}`
    }]
  };
}

function formatErrorMessage(error: OptimizelyError): string {
  let message = `Error: ${error.message}\nCode: ${error.code}`;
  
  if (error.statusCode) {
    message += `\nStatus: ${error.statusCode}`;
  }
  
  if (error.details) {
    message += `\nDetails: ${JSON.stringify(error.details, null, 2)}`;
  }
  
  return message;
}

export function isRetryableError(error: any): boolean {
  if (error instanceof OptimizelyError) {
    // Retry on rate limit, timeout, and 5xx errors
    return error.statusCode === 429 || 
           error.statusCode === 408 ||
           (error.statusCode !== undefined && error.statusCode >= 500);
  }
  
  // Retry on network errors
  return error instanceof TypeError && error.message.includes('fetch');
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffFactor = 2
  } = options;

  let lastError: any;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (!isRetryableError(error) || attempt === maxRetries) {
        throw error;
      }

      // Handle rate limit with retry-after header
      if (error instanceof RateLimitError && error.details?.retryAfter) {
        delay = error.details.retryAfter * 1000;
      }

      console.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Exponential backoff
      delay = Math.min(delay * backoffFactor, maxDelay);
    }
  }

  throw lastError;
}