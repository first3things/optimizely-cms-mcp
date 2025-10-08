/**
 * Fragment generation and caching types
 */

/**
 * Generated fragment with metadata
 */
export interface GeneratedFragment {
  /** Fragment name (e.g., "AllComponents") */
  name: string;

  /** Fragment GraphQL content */
  content: string;

  /** Component types included in the fragment */
  componentTypes: string[];

  /** When the fragment was generated */
  generatedAt?: Date;
}

/**
 * Cache metadata stored on disk
 */
export interface CacheMetadata {
  /** Schema version hash */
  schemaVersion: string;

  /** Graph API endpoint */
  endpoint: string;

  /** When cache was generated */
  generated: string;

  /** List of component types in cache */
  componentTypes: string[];

  /** Number of fragments cached */
  fragmentCount: number;
}

/**
 * Fragment cache entry
 */
export interface FragmentCacheEntry {
  /** Fragment content */
  content: string;

  /** When cached */
  cachedAt: Date;

  /** Cache hit count (for analytics) */
  hitCount?: number;
}
