import { z } from 'zod';

// Validation schemas for query parameters
export const SearchParamsSchema = z.object({
  query: z.string().min(1),
  types: z.array(z.string()).optional(),
  fields: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  skip: z.number().int().min(0).default(0),
  locale: z.string().optional(),
  orderBy: z.object({
    field: z.string(),
    direction: z.enum(['asc', 'desc']).default('asc')
  }).optional()
});

export const GetContentParamsSchema = z.object({
  id: z.string().min(1),
  fields: z.array(z.string()).optional(),
  locale: z.string().optional(),
  includeRelated: z.boolean().optional()
});

export const AutocompleteParamsSchema = z.object({
  query: z.string().min(1),
  field: z.string(),
  limit: z.number().int().min(1).max(20).default(10),
  locale: z.string().optional()
});

/**
 * @deprecated Use intelligent-query-builder.ts instead
 * This file now only exports validation schemas for backward compatibility
 */