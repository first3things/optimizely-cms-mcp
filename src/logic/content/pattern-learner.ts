/**
 * Pattern Learning System
 * Learns from successful content creations to improve field population
 */

import { getLogger } from '../../utils/logger.js';
import { withCache } from '../../utils/cache.js';
import * as fs from 'fs/promises';
import * as path from 'path';

interface FieldPattern {
  contentType: string;
  fieldPath: string;
  successfulValues: Array<{
    value: any;
    context: Record<string, any>;
    timestamp: string;
    frequency: number;
  }>;
}

interface LearnedPatterns {
  version: string;
  lastUpdated: string;
  patterns: FieldPattern[];
}

export class PatternLearner {
  private logger = getLogger();
  private patterns: Map<string, FieldPattern> = new Map();
  private patternsFile: string;
  private saveDebounceTimer?: NodeJS.Timeout;
  
  constructor(dataDir: string = './data') {
    this.patternsFile = path.join(dataDir, 'learned-patterns.json');
    this.loadPatterns().catch(err => 
      this.logger.warn('Failed to load learned patterns:', err)
    );
  }
  
  /**
   * Learn from a successful content creation
   */
  async learnFromSuccess(
    contentType: string,
    fields: Record<string, any>,
    context?: Record<string, any>
  ): Promise<void> {
    this.logger.debug('Learning from successful content creation', {
      contentType,
      fieldCount: Object.keys(fields).length
    });
    
    // Process each field
    for (const [fieldPath, value] of Object.entries(fields)) {
      if (value === null || value === undefined || value === '') {
        continue;
      }
      
      const key = `${contentType}:${fieldPath}`;
      let pattern = this.patterns.get(key);
      
      if (!pattern) {
        pattern = {
          contentType,
          fieldPath,
          successfulValues: []
        };
        this.patterns.set(key, pattern);
      }
      
      // Find if this value already exists
      const existingIndex = pattern.successfulValues.findIndex(
        sv => this.valuesEqual(sv.value, value)
      );
      
      if (existingIndex >= 0) {
        // Increment frequency
        pattern.successfulValues[existingIndex].frequency++;
        pattern.successfulValues[existingIndex].timestamp = new Date().toISOString();
      } else {
        // Add new value
        pattern.successfulValues.push({
          value,
          context: context || {},
          timestamp: new Date().toISOString(),
          frequency: 1
        });
      }
      
      // Keep only top 10 most frequent values
      pattern.successfulValues.sort((a, b) => b.frequency - a.frequency);
      pattern.successfulValues = pattern.successfulValues.slice(0, 10);
    }
    
    // Debounce save to avoid excessive writes
    this.debouncedSave();
  }
  
  /**
   * Get learned value suggestions for a field
   */
  async getSuggestions(
    contentType: string,
    fieldPath: string,
    context?: Record<string, any>
  ): Promise<any[]> {
    const key = `${contentType}:${fieldPath}`;
    const pattern = this.patterns.get(key);
    
    if (!pattern || pattern.successfulValues.length === 0) {
      return [];
    }
    
    // Return values sorted by frequency and recency
    return pattern.successfulValues
      .map(sv => sv.value)
      .slice(0, 5); // Return top 5 suggestions
  }
  
  /**
   * Get the most likely value for a field based on patterns
   */
  async getMostLikelyValue(
    contentType: string,
    fieldPath: string,
    context?: Record<string, any>
  ): Promise<any | undefined> {
    const suggestions = await this.getSuggestions(contentType, fieldPath, context);
    return suggestions.length > 0 ? suggestions[0] : undefined;
  }
  
  /**
   * Get field correlation patterns
   */
  async getFieldCorrelations(
    contentType: string,
    sourceField: string,
    targetField: string
  ): Promise<Map<any, any[]>> {
    // This would analyze patterns to find correlations
    // For example: when Title is X, MetaTitle is often Y
    // Implementation would require more sophisticated pattern matching
    return new Map();
  }
  
  /**
   * Export learned patterns for analysis
   */
  async exportPatterns(): Promise<LearnedPatterns> {
    const patterns = Array.from(this.patterns.values());
    
    return {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      patterns: patterns.map(p => ({
        ...p,
        // Remove less relevant patterns
        successfulValues: p.successfulValues.filter(sv => sv.frequency > 1)
      }))
    };
  }
  
  /**
   * Import patterns from another source
   */
  async importPatterns(data: LearnedPatterns): Promise<void> {
    this.logger.info('Importing learned patterns', {
      patternCount: data.patterns.length
    });
    
    for (const pattern of data.patterns) {
      const key = `${pattern.contentType}:${pattern.fieldPath}`;
      const existing = this.patterns.get(key);
      
      if (existing) {
        // Merge with existing patterns
        for (const newValue of pattern.successfulValues) {
          const existingIndex = existing.successfulValues.findIndex(
            sv => this.valuesEqual(sv.value, newValue.value)
          );
          
          if (existingIndex >= 0) {
            existing.successfulValues[existingIndex].frequency += newValue.frequency;
          } else {
            existing.successfulValues.push(newValue);
          }
        }
        
        // Re-sort and limit
        existing.successfulValues.sort((a, b) => b.frequency - a.frequency);
        existing.successfulValues = existing.successfulValues.slice(0, 10);
      } else {
        this.patterns.set(key, pattern);
      }
    }
    
    await this.savePatterns();
  }
  
  /**
   * Clear learned patterns for a content type
   */
  async clearPatterns(contentType?: string): Promise<void> {
    if (contentType) {
      // Clear specific content type
      const keysToDelete = Array.from(this.patterns.keys())
        .filter(key => key.startsWith(`${contentType}:`));
      
      keysToDelete.forEach(key => this.patterns.delete(key));
    } else {
      // Clear all
      this.patterns.clear();
    }
    
    await this.savePatterns();
  }
  
  /**
   * Load patterns from disk
   */
  private async loadPatterns(): Promise<void> {
    try {
      const data = await fs.readFile(this.patternsFile, 'utf-8');
      const loaded: LearnedPatterns = JSON.parse(data);
      
      // Validate version compatibility
      if (loaded.version !== '1.0') {
        this.logger.warn('Pattern file version mismatch, starting fresh');
        return;
      }
      
      // Load patterns into map
      for (const pattern of loaded.patterns) {
        const key = `${pattern.contentType}:${pattern.fieldPath}`;
        this.patterns.set(key, pattern);
      }
      
      this.logger.info('Loaded learned patterns', {
        patternCount: this.patterns.size
      });
    } catch (error) {
      // File doesn't exist or is invalid - that's ok, start fresh
      this.logger.debug('No existing patterns found, starting fresh');
    }
  }
  
  /**
   * Save patterns to disk
   */
  private async savePatterns(): Promise<void> {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.patternsFile);
      await fs.mkdir(dataDir, { recursive: true });
      
      const data = await this.exportPatterns();
      await fs.writeFile(
        this.patternsFile,
        JSON.stringify(data, null, 2),
        'utf-8'
      );
      
      this.logger.debug('Saved learned patterns', {
        patternCount: this.patterns.size
      });
    } catch (error) {
      this.logger.error('Failed to save learned patterns:', error);
    }
  }
  
  /**
   * Debounced save to avoid excessive disk writes
   */
  private debouncedSave(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    
    this.saveDebounceTimer = setTimeout(() => {
      this.savePatterns().catch(err =>
        this.logger.error('Failed to save patterns:', err)
      );
    }, 5000); // Save after 5 seconds of no activity
  }
  
  /**
   * Compare values for equality
   */
  private valuesEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    
    // Handle objects/arrays
    if (typeof a === 'object') {
      return JSON.stringify(a) === JSON.stringify(b);
    }
    
    return false;
  }
}

// Singleton instance
let patternLearner: PatternLearner | null = null;

export function getPatternLearner(dataDir?: string): PatternLearner {
  if (!patternLearner) {
    patternLearner = new PatternLearner(dataDir);
  }
  return patternLearner;
}