/**
 * Fragment Cache Service
 *
 * Multi-tier caching system for GraphQL fragments:
 * 1. In-memory cache (fastest, ~0.1ms)
 * 2. File system cache (persistent, ~10ms)
 * 3. Dynamic generation (slowest, ~200ms)
 *
 * Cache is invalidated when schema version changes or endpoint changes,
 * ensuring fragments always match the current CMS schema.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { SchemaIntrospector } from '../logic/graph/schema-introspector.js';
import { Config } from '../types/config.js';
import { CacheMetadata, FragmentCacheEntry } from '../types/fragments.js';
import { getLogger } from '../utils/logger.js';

export class FragmentCache {
  private logger = getLogger();
  private memoryCache: Map<string, FragmentCacheEntry> = new Map();
  private cacheDir: string;
  private instanceId: string | null = null;

  constructor(
    private config: Config,
    private introspector: SchemaIntrospector
  ) {
    this.cacheDir = path.join(process.cwd(), '.cache', 'fragments');
  }

  /**
   * Get cached fragment by name (checks memory, then disk)
   * Returns null if not found in either cache
   */
  async getCachedFragment(name: string): Promise<string | null> {
    // Check memory cache first (fastest)
    const memoryEntry = this.memoryCache.get(name);
    if (memoryEntry) {
      this.logger.debug(`Fragment cache hit (memory): ${name}`);

      // Update hit count for analytics
      memoryEntry.hitCount = (memoryEntry.hitCount || 0) + 1;

      return memoryEntry.content;
    }

    // Check disk cache (medium speed)
    try {
      const instanceId = await this.getInstanceId();
      const fragmentPath = path.join(this.cacheDir, instanceId, `${name}.graphql`);

      const content = await fs.readFile(fragmentPath, 'utf-8');
      this.logger.debug(`Fragment cache hit (disk): ${name}`);

      // Store in memory for future use
      this.memoryCache.set(name, {
        content,
        cachedAt: new Date(),
        hitCount: 1
      });

      return content;
    } catch (error) {
      // Not in disk cache
      this.logger.debug(`Fragment cache miss: ${name}`);
      return null;
    }
  }

  /**
   * Store fragment in cache (memory + disk)
   * Persists to disk for use across process restarts
   */
  async setCachedFragment(
    name: string,
    content: string,
    metadata?: Partial<CacheMetadata>
  ): Promise<void> {
    const now = new Date();

    // Store in memory
    this.memoryCache.set(name, {
      content,
      cachedAt: now,
      hitCount: 0
    });

    // Store on disk
    try {
      const instanceId = await this.getInstanceId();
      const instanceDir = path.join(this.cacheDir, instanceId);

      // Ensure directory exists
      await fs.mkdir(instanceDir, { recursive: true });

      // Write fragment file
      const fragmentPath = path.join(instanceDir, `${name}.graphql`);
      await fs.writeFile(fragmentPath, content, 'utf-8');

      // Update metadata if provided
      if (metadata) {
        await this.updateMetadata(instanceId, metadata);
      }

      this.logger.info(`Cached fragment: ${name}`, {
        path: fragmentPath,
        size: content.length
      });
    } catch (error) {
      this.logger.error(`Failed to cache fragment: ${name}`, { error });
    }
  }

  /**
   * Cache individual component fragments
   * Stores multiple fragments in a components/ subdirectory
   */
  async cacheComponentFragments(fragments: Map<string, string>): Promise<void> {
    const instanceId = await this.getInstanceId();
    const componentsDir = path.join(this.cacheDir, instanceId, 'components');

    // Ensure directory exists
    await fs.mkdir(componentsDir, { recursive: true });

    // Write each component fragment
    for (const [typeName, content] of fragments) {
      try {
        const fragmentPath = path.join(componentsDir, `${typeName}.graphql`);
        await fs.writeFile(fragmentPath, content, 'utf-8');

        // Also store in memory
        this.memoryCache.set(`component:${typeName}`, {
          content,
          cachedAt: new Date(),
          hitCount: 0
        });
      } catch (error) {
        this.logger.error(`Failed to cache component fragment: ${typeName}`, { error });
      }
    }

    this.logger.info(`Cached ${fragments.size} component fragments`);
  }

  /**
   * Update cache metadata file
   * Tracks schema version, component types, and generation time
   */
  private async updateMetadata(
    instanceId: string,
    updates: Partial<CacheMetadata>
  ): Promise<void> {
    const metadataPath = path.join(this.cacheDir, instanceId, 'metadata.json');

    let metadata: CacheMetadata;

    try {
      const existing = await fs.readFile(metadataPath, 'utf-8');
      metadata = { ...JSON.parse(existing), ...updates };
    } catch {
      // Create new metadata
      metadata = {
        schemaVersion: await this.getSchemaVersion(),
        endpoint: this.config.graph.endpoint,
        generated: new Date().toISOString(),
        componentTypes: [],
        fragmentCount: 0,
        ...updates
      };
    }

    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  /**
   * Get cache metadata
   * Returns null if cache doesn't exist
   */
  async getMetadata(): Promise<CacheMetadata | null> {
    try {
      const instanceId = await this.getInstanceId();
      const metadataPath = path.join(this.cacheDir, instanceId, 'metadata.json');
      const content = await fs.readFile(metadataPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Invalidate cache (remove from memory and disk)
   * Call this when schema changes or manual cache clear is needed
   */
  async invalidateCache(): Promise<void> {
    this.logger.info('Invalidating fragment cache');

    // Clear memory
    this.memoryCache.clear();

    // Clear disk
    try {
      const instanceId = await this.getInstanceId();
      const instanceDir = path.join(this.cacheDir, instanceId);
      await fs.rm(instanceDir, { recursive: true, force: true });
      this.logger.info('Fragment cache invalidated');
    } catch (error) {
      this.logger.error('Failed to invalidate cache', { error });
    }
  }

  /**
   * Get cache statistics
   * Useful for monitoring and debugging
   */
  getCacheStats(): {
    memorySize: number;
    totalHits: number;
    entries: Array<{ name: string; hitCount: number; age: number }>;
  } {
    const now = Date.now();
    const entries: Array<{ name: string; hitCount: number; age: number }> = [];
    let totalHits = 0;

    for (const [name, entry] of this.memoryCache) {
      const hitCount = entry.hitCount || 0;
      const age = Math.floor((now - entry.cachedAt.getTime()) / 1000); // seconds

      entries.push({ name, hitCount, age });
      totalHits += hitCount;
    }

    return {
      memorySize: this.memoryCache.size,
      totalHits,
      entries: entries.sort((a, b) => b.hitCount - a.hitCount) // Sort by most hits
    };
  }

  /**
   * Get instance ID (hash of endpoint + schema version)
   * Used to create unique cache directories per CMS instance
   */
  async getInstanceId(): Promise<string> {
    if (this.instanceId) {
      return this.instanceId;
    }

    const schemaVersion = await this.getSchemaVersion();
    const endpoint = this.config.graph.endpoint;
    const combined = `${endpoint}:${schemaVersion}`;

    this.instanceId = crypto
      .createHash('sha256')
      .update(combined)
      .digest('hex')
      .substring(0, 16);

    this.logger.debug(`Instance ID: ${this.instanceId}`);
    return this.instanceId;
  }

  /**
   * Get schema version from introspector
   * Creates a hash of the schema structure to detect changes
   */
  private async getSchemaVersion(): Promise<string> {
    // Get schema and hash it
    await this.introspector.initialize();
    const queryFields = await this.introspector.getQueryFields();
    const fieldNames = queryFields.map(f => f.name).sort().join(',');

    return crypto
      .createHash('sha256')
      .update(fieldNames)
      .digest('hex')
      .substring(0, 8);
  }

  /**
   * Pre-warm cache by generating and storing all fragments
   * Useful for initialization to avoid cold-start delays
   */
  async prewarmCache(componentTypes: string[], fragmentContent: string): Promise<void> {
    this.logger.info('Pre-warming fragment cache');

    await this.setCachedFragment('AllComponents', fragmentContent, {
      componentTypes,
      fragmentCount: componentTypes.length,
      generated: new Date().toISOString()
    });

    this.logger.info('Fragment cache pre-warmed');
  }
}
