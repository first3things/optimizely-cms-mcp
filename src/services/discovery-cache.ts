import { CacheManager, getCacheManager, withCache } from '../utils/cache.js';
import { getLogger } from '../utils/logger.js';
import { ContentTypeInfo, FieldInfo, SchemaInfo } from '../types/discovery.js';
import type { Logger } from '../types/logger.js';

interface CachedDiscovery<T> {
  data: T;
  timestamp: string;
  fromCache: boolean;
}

export interface DiscoveryCacheConfig {
  // Cache TTLs in seconds
  typesCacheTtl?: number;      // Default: 5 minutes
  schemaCacheTtl?: number;     // Default: 10 minutes  
  introspectionCacheTtl?: number; // Default: 1 hour
  
  // Progressive caching
  enableProgressive?: boolean;  // Default: true
  
  // Cache warming
  warmOnStartup?: boolean;     // Default: false
}

/**
 * Specialized cache layer for discovery operations
 * Provides progressive enhancement and intelligent invalidation
 */
export class DiscoveryCache {
  private cache: CacheManager;
  private logger: Logger;
  private config: Required<DiscoveryCacheConfig>;
  
  // Track schema versions for invalidation
  private schemaVersions: Map<string, string> = new Map();
  
  constructor(config: DiscoveryCacheConfig = {}) {
    this.cache = getCacheManager();
    this.logger = getLogger();
    
    this.config = {
      typesCacheTtl: config.typesCacheTtl ?? 300,        // 5 minutes
      schemaCacheTtl: config.schemaCacheTtl ?? 600,     // 10 minutes
      introspectionCacheTtl: config.introspectionCacheTtl ?? 3600, // 1 hour
      enableProgressive: config.enableProgressive ?? true,
      warmOnStartup: config.warmOnStartup ?? false
    };
  }
  
  /**
   * Get cached content types
   */
  async getCachedTypes(): Promise<CachedDiscovery<ContentTypeInfo[]> | null> {
    const cacheKey = this.getTypesKey();
    const cached = this.cache.get<ContentTypeInfo[]>(cacheKey);
    
    if (cached) {
      return {
        data: cached,
        timestamp: new Date().toISOString(),
        fromCache: true
      };
    }
    
    return null;
  }
  
  /**
   * Cache content types
   */
  async cacheTypes(types: ContentTypeInfo[]): Promise<void> {
    const cacheKey = this.getTypesKey();
    this.cache.set(cacheKey, types, this.config.typesCacheTtl);
    
    // Track type names for progressive enhancement
    if (this.config.enableProgressive) {
      for (const type of types) {
        this.trackContentType(type.name);
      }
    }
    
    this.logger.debug(`Cached ${types.length} content types`);
  }
  
  /**
   * Get cached schema for a content type
   */
  async getCachedSchema(contentType: string): Promise<CachedDiscovery<SchemaInfo> | null> {
    const cacheKey = this.getSchemaKey(contentType);
    const cached = this.cache.get<SchemaInfo>(cacheKey);
    
    if (cached) {
      return {
        data: cached,
        timestamp: new Date().toISOString(),
        fromCache: true
      };
    }
    
    return null;
  }
  
  /**
   * Cache schema for a content type
   */
  async cacheSchema(contentType: string, schema: SchemaInfo, version?: string): Promise<void> {
    const cacheKey = this.getSchemaKey(contentType);
    this.cache.set(cacheKey, schema, this.config.schemaCacheTtl);
    
    // Track schema version for invalidation
    if (version) {
      this.schemaVersions.set(contentType, version);
    }
    
    // Progressive enhancement: cache related data
    if (this.config.enableProgressive) {
      await this.cacheRelatedFields(contentType, schema.fields);
    }
    
    this.logger.debug(`Cached schema for ${contentType}`);
  }
  
  /**
   * Get cached fields for a content type
   */
  async getCachedFields(contentType: string): Promise<CachedDiscovery<FieldInfo[]> | null> {
    const cacheKey = this.getFieldsKey(contentType);
    const cached = this.cache.get<FieldInfo[]>(cacheKey);
    
    if (cached) {
      return {
        data: cached,
        timestamp: new Date().toISOString(),
        fromCache: true
      };
    }
    
    return null;
  }
  
  /**
   * Cache fields for a content type
   */
  async cacheFields(contentType: string, fields: FieldInfo[]): Promise<void> {
    const cacheKey = this.getFieldsKey(contentType);
    this.cache.set(cacheKey, fields, this.config.schemaCacheTtl);
    this.logger.debug(`Cached ${fields.length} fields for ${contentType}`);
  }
  
  /**
   * Get cached GraphQL introspection
   */
  async getCachedIntrospection(): Promise<CachedDiscovery<any> | null> {
    const cacheKey = this.getIntrospectionKey();
    const cached = this.cache.get<any>(cacheKey);
    
    if (cached) {
      return {
        data: cached,
        timestamp: new Date().toISOString(),
        fromCache: true
      };
    }
    
    return null;
  }
  
  /**
   * Cache GraphQL introspection result
   */
  async cacheIntrospection(introspection: any): Promise<void> {
    const cacheKey = this.getIntrospectionKey();
    this.cache.set(cacheKey, introspection, this.config.introspectionCacheTtl);
    this.logger.debug('Cached GraphQL introspection');
  }
  
  /**
   * Invalidate cache for a specific content type
   */
  async invalidateContentType(contentType: string): Promise<void> {
    const keysToInvalidate = [
      this.getSchemaKey(contentType),
      this.getFieldsKey(contentType),
      this.getAnalysisKey(contentType)
    ];
    
    for (const key of keysToInvalidate) {
      this.cache.delete(key);
    }
    
    this.logger.info(`Invalidated cache for content type: ${contentType}`);
  }
  
  /**
   * Invalidate all discovery caches
   */
  async invalidateAll(): Promise<void> {
    const stats = this.cache.getStats();
    
    // Clear all discovery-related keys
    this.cache.clear();
    this.schemaVersions.clear();
    
    this.logger.info(`Cleared all discovery caches (${stats.size} entries)`);
  }
  
  /**
   * Check if schema has changed (for smart invalidation)
   */
  hasSchemaChanged(contentType: string, newVersion: string): boolean {
    const oldVersion = this.schemaVersions.get(contentType);
    return oldVersion !== undefined && oldVersion !== newVersion;
  }
  
  /**
   * Get cache statistics
   */
  getStats(): {
    totalSize: number;
    typesCached: number;
    schemasCached: number;
    hitRate?: number;
  } {
    const stats = this.cache.getStats();
    
    return {
      totalSize: stats.size,
      typesCached: this.cache.has(this.getTypesKey()) ? 1 : 0,
      schemasCached: this.schemaVersions.size
    };
  }
  
  /**
   * Warm cache with initial data
   */
  async warmCache(loadFn: () => Promise<{
    types?: ContentTypeInfo[];
    introspection?: any;
  }>): Promise<void> {
    if (!this.config.warmOnStartup) {
      return;
    }
    
    this.logger.info('Warming discovery cache...');
    
    try {
      const data = await loadFn();
      
      if (data.types) {
        await this.cacheTypes(data.types);
      }
      
      if (data.introspection) {
        await this.cacheIntrospection(data.introspection);
      }
      
      this.logger.info('Discovery cache warmed successfully');
    } catch (error) {
      this.logger.error('Failed to warm discovery cache:', error);
    }
  }
  
  /**
   * Progressive enhancement: cache related fields
   */
  private async cacheRelatedFields(contentType: string, fields: FieldInfo[]): Promise<void> {
    // Cache searchable fields separately for faster search discovery
    const searchableFields = fields.filter(f => f.searchable);
    if (searchableFields.length > 0) {
      const key = `discovery:searchable:${contentType}`;
      this.cache.set(key, searchableFields, this.config.schemaCacheTtl);
    }
    
    // Cache required fields for validation
    const requiredFields = fields.filter(f => f.required);
    if (requiredFields.length > 0) {
      const key = `discovery:required:${contentType}`;
      this.cache.set(key, requiredFields, this.config.schemaCacheTtl);
    }
  }
  
  /**
   * Track content type for progressive enhancement
   */
  private trackContentType(typeName: string): void {
    // Track access patterns for intelligent pre-caching
    const trackingKey = `discovery:access:${typeName}`;
    const accessCount = this.cache.get<number>(trackingKey) || 0;
    this.cache.set(trackingKey, accessCount + 1, 86400); // 24 hour tracking
  }
  
  // Cache key generators
  private getTypesKey(): string {
    return 'discovery:types:all';
  }
  
  private getSchemaKey(contentType: string): string {
    return `discovery:schema:${contentType}`;
  }
  
  private getFieldsKey(contentType: string): string {
    return `discovery:fields:${contentType}`;
  }
  
  private getAnalysisKey(contentType: string): string {
    return `discovery:analysis:${contentType}`;
  }
  
  private getIntrospectionKey(): string {
    return 'discovery:introspection:schema';
  }
}

// Singleton instance
let discoveryCacheInstance: DiscoveryCache | null = null;

/**
 * Get discovery cache instance
 */
export function getDiscoveryCache(config?: DiscoveryCacheConfig): DiscoveryCache {
  if (!discoveryCacheInstance) {
    discoveryCacheInstance = new DiscoveryCache(config);
  }
  return discoveryCacheInstance;
}

/**
 * Higher-order function for cached discovery operations
 */
export async function withDiscoveryCache<T>(
  cacheKey: string,
  discoveryFn: () => Promise<T>,
  ttl?: number
): Promise<CachedDiscovery<T>> {
  // First try the cache
  const cached = await withCache(cacheKey, async () => null, 0);
  
  if (cached !== null) {
    return {
      data: cached as T,
      timestamp: new Date().toISOString(),
      fromCache: true
    };
  }
  
  // Execute discovery function
  const startTime = Date.now();
  const data = await discoveryFn();
  const duration = Date.now() - startTime;
  
  // Cache the result
  const cache = getCacheManager();
  cache.set(cacheKey, data, ttl);
  
  getLogger().debug(`Discovery operation completed in ${duration}ms`, { cacheKey });
  
  return {
    data,
    timestamp: new Date().toISOString(),
    fromCache: false
  };
}