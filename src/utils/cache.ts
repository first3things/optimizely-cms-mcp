import { getLogger } from './logger.js';

interface CacheEntry<T> {
  value: T;
  expiry: number;
}

export class CacheManager {
  private cache = new Map<string, CacheEntry<any>>();
  private ttl: number;
  private maxSize: number;
  private logger = getLogger();

  constructor(ttlSeconds: number = 300, maxSize: number = 1000) {
    this.ttl = ttlSeconds * 1000;
    this.maxSize = maxSize;
    
    // Start cleanup timer
    this.startCleanupTimer();
  }

  set<T>(key: string, value: T, customTtl?: number): void {
    const ttl = customTtl ? customTtl * 1000 : this.ttl;
    const expiry = Date.now() + ttl;
    
    // Check cache size and evict oldest if necessary
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }
    
    this.cache.set(key, { value, expiry });
    this.logger.debug(`Cache set: ${key} (expires in ${ttl}ms)`);
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.logger.debug(`Cache miss: ${key}`);
      return null;
    }
    
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      this.logger.debug(`Cache expired: ${key}`);
      return null;
    }
    
    this.logger.debug(`Cache hit: ${key}`);
    return entry.value as T;
  }

  has(key: string): boolean {
    const value = this.get(key);
    return value !== null;
  }

  delete(key: string): boolean {
    const result = this.cache.delete(key);
    if (result) {
      this.logger.debug(`Cache deleted: ${key}`);
    }
    return result;
  }

  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.logger.info(`Cache cleared (${size} entries removed)`);
  }

  size(): number {
    return this.cache.size;
  }

  // Get cache statistics
  getStats(): {
    size: number;
    maxSize: number;
    ttl: number;
  } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl / 1000
    };
  }

  // Evict oldest entry when cache is full
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiry < oldestTime) {
        oldestTime = entry.expiry;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.logger.debug(`Cache evicted (oldest): ${oldestKey}`);
    }
  }

  // Clean up expired entries periodically
  private cleanup(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        expiredKeys.push(key);
      }
    }
    
    for (const key of expiredKeys) {
      this.cache.delete(key);
    }
    
    if (expiredKeys.length > 0) {
      this.logger.debug(`Cache cleanup: removed ${expiredKeys.length} expired entries`);
    }
  }

  private startCleanupTimer(): void {
    // Run cleanup every minute
    setInterval(() => this.cleanup(), 60000);
  }

  // Decorator for caching function results
  static cacheable<T extends (...args: any[]) => Promise<any>>(
    keyPrefix: string,
    ttl?: number
  ) {
    return function(
      target: any,
      propertyKey: string,
      descriptor: PropertyDescriptor
    ) {
      const originalMethod = descriptor.value;
      
      descriptor.value = async function(...args: any[]) {
        const cache = getCacheManager();
        const cacheKey = `${keyPrefix}:${JSON.stringify(args)}`;
        
        // Try to get from cache
        const cached = cache.get(cacheKey);
        if (cached !== null) {
          return cached;
        }
        
        // Execute original method
        const result = await originalMethod.apply(this, args);
        
        // Cache the result
        cache.set(cacheKey, result, ttl);
        
        return result;
      };
      
      return descriptor;
    };
  }
}

// Singleton instance
let cacheInstance: CacheManager | null = null;

export function getCacheManager(): CacheManager {
  if (!cacheInstance) {
    const ttl = parseInt(process.env.CACHE_TTL || '300', 10);
    cacheInstance = new CacheManager(ttl);
  }
  return cacheInstance;
}

// Helper function to create cache keys
export function createCacheKey(prefix: string, ...parts: any[]): string {
  const sanitizedParts = parts.map(part => {
    if (typeof part === 'object') {
      return JSON.stringify(part);
    }
    return String(part);
  });
  
  return `${prefix}:${sanitizedParts.join(':')}`;
}

// Cache wrapper for async functions
export async function withCache<T>(
  key: string,
  fn: () => Promise<T>,
  ttl?: number
): Promise<T> {
  const cache = getCacheManager();
  
  // Try cache first
  const cached = cache.get<T>(key);
  if (cached !== null) {
    return cached;
  }
  
  // Execute function and cache result
  const result = await fn();
  cache.set(key, result, ttl);
  
  return result;
}