export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

class ConsoleLogger implements Logger {
  private static levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };

  constructor(private level: LogLevel = 'info') {}

  private shouldLog(level: LogLevel): boolean {
    return ConsoleLogger.levels[level] >= ConsoleLogger.levels[this.level];
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message), ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message), ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message), ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message), ...args);
    }
  }
}

// Singleton logger instance
let loggerInstance: Logger | null = null;

export function createLogger(level: LogLevel = 'info'): Logger {
  return new ConsoleLogger(level);
}

export function getLogger(): Logger {
  if (!loggerInstance) {
    const logLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
    loggerInstance = createLogger(logLevel);
  }
  return loggerInstance;
}

// Utility function to log API requests
export function logAPIRequest(
  method: string,
  url: string,
  options?: {
    headers?: Record<string, string>;
    body?: any;
  }
): void {
  const logger = getLogger();
  logger.debug(`API Request: ${method} ${url}`, {
    headers: options?.headers ? sanitizeHeaders(options.headers) : undefined,
    body: options?.body
  });
}

// Utility function to log API responses
export function logAPIResponse(
  url: string,
  status: number,
  duration: number,
  body?: any
): void {
  const logger = getLogger();
  const level = status >= 400 ? 'error' : 'debug';
  
  logger[level](`API Response: ${url} - ${status} (${duration}ms)`, {
    body: body ? truncateBody(body) : undefined
  });
}

// Sanitize headers to hide sensitive information
function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized = { ...headers };
  const sensitiveHeaders = ['authorization', 'api-key', 'x-api-key', 'cookie'];
  
  for (const header of sensitiveHeaders) {
    if (sanitized[header]) {
      sanitized[header] = '***';
    }
  }
  
  return sanitized;
}

// Truncate large response bodies
function truncateBody(body: any, maxLength: number = 1000): any {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  
  if (bodyStr.length <= maxLength) {
    return body;
  }
  
  return bodyStr.substring(0, maxLength) + '... (truncated)';
}

// Performance logging helper
export function measurePerformance<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const logger = getLogger();
  const start = Date.now();
  
  return fn()
    .then(result => {
      const duration = Date.now() - start;
      logger.debug(`Performance: ${name} completed in ${duration}ms`);
      return result;
    })
    .catch(error => {
      const duration = Date.now() - start;
      logger.error(`Performance: ${name} failed after ${duration}ms`, error);
      throw error;
    });
}