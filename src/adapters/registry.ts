/**
 * CMS Adapter Registry
 * Manages registration and retrieval of CMS adapters
 */

import { CMSAdapter } from './base.js';
import { OptimizelyAdapter } from './optimizely-adapter.js';
import { CMAConfig } from '../types/config.js';
import { getLogger } from '../utils/logger.js';

export class AdapterRegistry {
  private static instance: AdapterRegistry;
  private adapters = new Map<string, CMSAdapter>();
  private logger = getLogger();
  
  private constructor() {}
  
  static getInstance(): AdapterRegistry {
    if (!AdapterRegistry.instance) {
      AdapterRegistry.instance = new AdapterRegistry();
    }
    return AdapterRegistry.instance;
  }
  
  /**
   * Register a CMS adapter
   */
  register(name: string, adapter: CMSAdapter): void {
    this.logger.debug(`Registering adapter: ${name}`);
    this.adapters.set(name.toLowerCase(), adapter);
  }
  
  /**
   * Get a CMS adapter by name
   */
  get(name: string): CMSAdapter | undefined {
    return this.adapters.get(name.toLowerCase());
  }
  
  /**
   * Get or create an Optimizely adapter
   */
  getOptimizelyAdapter(config: CMAConfig): OptimizelyAdapter {
    const key = 'optimizely';
    let adapter = this.adapters.get(key) as OptimizelyAdapter;
    
    if (!adapter) {
      adapter = new OptimizelyAdapter(config);
      this.register(key, adapter);
    }
    
    return adapter;
  }
  
  /**
   * List all registered adapters
   */
  list(): string[] {
    return Array.from(this.adapters.keys());
  }
  
  /**
   * Clear all adapters (useful for testing)
   */
  clear(): void {
    this.adapters.clear();
  }
}