/**
 * Type definitions for discovery operations
 */

export interface ContentTypeInfo {
  name: string;
  displayName?: string;
  description?: string;
  category?: string;
  isAbstract?: boolean;
  baseType?: string;
  interfaces?: string[];
}

export interface FieldInfo {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  searchable?: boolean;
  localizable?: boolean;
  allowedTypes?: string[];
  validationRules?: any[];
}

export interface SchemaInfo {
  contentType: string;
  fields: FieldInfo[];
  metadata?: {
    hasUrl?: boolean;
    hasNavigation?: boolean;
    hasVersions?: boolean;
    hasSeo?: boolean;
  };
  composition?: {
    supportsContentAreas?: boolean;
    allowedTypes?: string[];
  };
}

export interface DiscoveryResult<T> {
  data: T;
  cached: boolean;
  timestamp: string;
  duration?: number;
}

export interface DiscoveryOptions {
  useCache?: boolean;
  forceRefresh?: boolean;
  includeMetadata?: boolean;
  includeExamples?: boolean;
}