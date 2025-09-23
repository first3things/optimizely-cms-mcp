// Optimizely Content Management API Types

export interface ContentReference {
  id?: number;
  workId?: number;
  guidValue?: string;
  providerName?: string;
}

export interface ContentMetadata {
  key: string;
  locale: string;
  displayName: string;
  contentType: string;
  published?: string;
  created: string;
  modified: string;
  status: string;
  url?: {
    base: string;
    hierarchical: string;
  };
}

export interface ContentItem {
  contentLink: ContentReference;
  name: string;
  parentLink?: ContentReference;
  contentType?: string[];
  language?: LanguageInfo;
  existingLanguages?: string[];
  masterLanguage?: string;
  properties?: Record<string, any>;
  metadata?: ContentMetadata;
  status?: string;
  saved?: string;
  changed?: string;
  created?: string;
  createdBy?: string;
  changedBy?: string;
  published?: string;
}

export interface LanguageInfo {
  name: string;
  displayName: string;
  isMasterLanguage: boolean;
  isPreferredLanguage?: boolean;
  urlSegment?: string;
}

export interface ContentType {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  baseType?: string;
  properties: PropertyDefinition[];
  settings?: ContentTypeSettings;
}

export interface PropertyDefinition {
  name: string;
  displayName: string;
  description?: string;
  dataType: string;
  required: boolean;
  searchable?: boolean;
  settings?: Record<string, any>;
}

export interface ContentTypeSettings {
  allowedChildTypes?: string[];
  allowedParentTypes?: string[];
  sortOrder?: number;
  isAvailable?: boolean;
}

export interface VersionInfo {
  id: string;
  language: LanguageInfo;
  name: string;
  isMasterVersion: boolean;
  isCommonDraft: boolean;
  saved: string;
  savedBy: string;
  status: string;
}

export interface CreateContentRequest {
  contentType: string | string[];
  name: string;
  parentLink?: ContentReference;
  properties?: Record<string, any>;
  language?: string;
}

export interface UpdateContentRequest {
  name?: string;
  properties?: Record<string, any>;
  createNewVersion?: boolean;
}

export interface MoveContentRequest {
  target: ContentReference;
  createRedirect?: boolean;
}

export interface CopyContentRequest {
  target: ContentReference;
  includeDescendants?: boolean;
  newName?: string;
}

export interface PublishContentRequest {
  contentLinks: ContentReference[];
  includeDescendants?: boolean;
}

export interface WorkflowTransitionRequest {
  action: string;
  comment?: string;
}

export interface ContentListResult {
  items: ContentItem[];
  totalCount: number;
  continuationToken?: string;
}

export interface ValidationError {
  propertyName: string;
  message: string;
  severity: 'Error' | 'Warning' | 'Information';
}

export interface AssetMetadata {
  contentType: string;
  mimeType: string;
  fileSize: number;
  thumbnail?: string;
  alternativeText?: string;
  description?: string;
}

export interface AssetUploadRequest {
  file: Buffer | string;
  fileName: string;
  contentType: string;
  parentLink?: ContentReference;
  properties?: Record<string, any>;
}

export interface SearchRequest {
  query?: string;
  contentTypes?: string[];
  languages?: string[];
  properties?: Record<string, any>;
  skip?: number;
  top?: number;
  orderBy?: string;
  select?: string[];
  expand?: string[];
}