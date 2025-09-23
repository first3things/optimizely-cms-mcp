import { z } from 'zod';
import { ValidationError } from './errors.js';

// Common validation schemas
export const ContentIdSchema = z.string().min(1).describe('Content ID or key');
export const LanguageSchema = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).describe('Language code (e.g., en-US)');
export const LimitSchema = z.number().int().min(1).max(100).default(20);
export const SkipSchema = z.number().int().min(0).default(0);

export const PaginationSchema = z.object({
  limit: LimitSchema,
  skip: SkipSchema
});

export const FieldSelectionSchema = z.array(z.string()).optional().describe('Fields to return');

export const OrderBySchema = z.object({
  field: z.string(),
  direction: z.enum(['asc', 'desc']).default('asc')
}).optional();

// Validate input against schema
export function validateInput<T>(
  schema: z.ZodSchema<T>,
  input: unknown,
  errorMessage: string = 'Invalid input'
): T {
  const result = schema.safeParse(input);
  
  if (!result.success) {
    const errors = result.error.errors
      .map(e => `${e.path.join('.')}: ${e.message}`)
      .join('; ');
    
    throw new ValidationError(`${errorMessage}: ${errors}`, result.error.errors);
  }
  
  return result.data;
}

// Validate GraphQL query string
export function validateGraphQLQuery(query: string): void {
  if (!query || typeof query !== 'string') {
    throw new ValidationError('Query must be a non-empty string');
  }
  
  // Basic GraphQL query validation
  const trimmed = query.trim();
  if (!trimmed.match(/^(query|mutation|subscription|\{)/i)) {
    throw new ValidationError('Invalid GraphQL query format');
  }
}

// Validate URL
export function validateUrl(url: string): void {
  try {
    new URL(url);
  } catch {
    throw new ValidationError(`Invalid URL: ${url}`);
  }
}

// Validate content type
export function validateContentType(contentType: string): void {
  if (!contentType || typeof contentType !== 'string') {
    throw new ValidationError('Content type must be a non-empty string');
  }
  
  // Basic content type validation (alphanumeric and dots)
  if (!contentType.match(/^[a-zA-Z0-9.]+$/)) {
    throw new ValidationError(`Invalid content type format: ${contentType}`);
  }
}

// Validate file path
export function validateFilePath(path: string): void {
  if (!path || typeof path !== 'string') {
    throw new ValidationError('File path must be a non-empty string');
  }
  
  // Check for path traversal attempts
  if (path.includes('..') || path.includes('~')) {
    throw new ValidationError('Invalid file path: potential security risk');
  }
}

// Sanitize input for API calls
export function sanitizeInput(input: any): any {
  if (input === null || input === undefined) {
    return input;
  }
  
  if (typeof input === 'string') {
    // Remove control characters
    return input.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
  }
  
  if (Array.isArray(input)) {
    return input.map(sanitizeInput);
  }
  
  if (typeof input === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(input)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }
  
  return input;
}

// Validate JSON Patch operations
export const JSONPatchSchema = z.array(
  z.object({
    op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
    path: z.string().startsWith('/'),
    value: z.any().optional(),
    from: z.string().startsWith('/').optional()
  })
);

export function validateJSONPatch(patches: unknown): void {
  validateInput(JSONPatchSchema, patches, 'Invalid JSON Patch operations');
}