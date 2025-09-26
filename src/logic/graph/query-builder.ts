import { z } from 'zod';

// Common GraphQL fragments for Optimizely content
export const CONTENT_METADATA_FRAGMENT = `
  fragment ContentMetadata on _IContent {
    _metadata {
      key
      locale
      displayName
      types
      url {
        base
        hierarchical
      }
      published
      created
      lastModified
      status
    }
  }
`;

export const CONTENT_BASIC_FRAGMENT = `
  fragment ContentBasic on _IContent {
    ...ContentMetadata
  }
`;

// Query builders
export function buildSearchQuery(params: {
  searchTerm: string;
  types?: string[];
  locale?: string;
  limit?: number;
  skip?: number;
  orderBy?: { field: string; direction: 'asc' | 'desc' };
  includeScore?: boolean;
}): string {
  const whereClause = buildWhereClause({
    searchTerm: params.searchTerm,
    types: params.types,
    locale: params.locale
  });
  
  const orderByClause = params.orderBy 
    ? `orderBy: { ${params.orderBy.field}: ${params.orderBy.direction.toUpperCase()} }`
    : '';

  return `
    ${CONTENT_METADATA_FRAGMENT}
    
    query SearchContent(
      $limit: Int = ${params.limit || 20}
      $skip: Int = ${params.skip || 0}
    ) {
      content: _Content(
        where: ${whereClause}
        limit: $limit
        skip: $skip
        ${orderByClause}
      ) {
        items {
          ...ContentMetadata
          ${params.includeScore ? '_score' : ''}
          ... on _IContent {
            _metadata {
              displayName
            }
          }
        }
        total
        facets {
          _metadata {
            types(limit: 10) {
              name
              count
            }
            locale(limit: 10) {
              name
              count
            }
          }
        }
      }
    }
  `;
}

export function buildGetContentQuery(params: {
  id: string;
  locale?: string;
  fields?: string[];
  includeRelated?: boolean;
}): string {
  const fieldsSelection = params.fields 
    ? params.fields.join('\n          ')
    : '';

  return `
    ${CONTENT_METADATA_FRAGMENT}
    ${CONTENT_BASIC_FRAGMENT}
    
    query GetContent($id: String!) {
      content: _Content(
        where: { 
          _metadata: { 
            key: { eq: $id }
            ${params.locale ? `locale: { eq: "${params.locale}" }` : ''}
          }
        }
        limit: 1
      ) {
        items {
          ...ContentBasic
          ${fieldsSelection}
          ${params.includeRelated ? `
            _references {
              ... on _IContent {
                ...ContentMetadata
              }
            }
          ` : ''}
        }
      }
    }
  `;
}

export function buildGetChildrenQuery(params: {
  parentId: string;
  contentTypes?: string[];
  limit?: number;
  skip?: number;
  orderBy?: { field: string; direction: 'asc' | 'desc' };
}): string {
  const whereConditions = [`_metadata: { parent: { id: { eq: "${params.parentId}" } } }`];
  
  if (params.contentTypes && params.contentTypes.length > 0) {
    whereConditions.push(
      `_metadata: { contentType: { in: [${params.contentTypes.map(t => `"${t}"`).join(', ')}] } }`
    );
  }

  const whereClause = `{ ${whereConditions.join(', ')} }`;
  const orderByClause = params.orderBy 
    ? `orderBy: { ${params.orderBy.field}: ${params.orderBy.direction.toUpperCase()} }`
    : 'orderBy: { _metadata: { displayName: ASC } }';

  return `
    ${CONTENT_METADATA_FRAGMENT}
    ${CONTENT_BASIC_FRAGMENT}
    
    query GetChildren(
      $limit: Int = ${params.limit || 50}
      $skip: Int = ${params.skip || 0}
    ) {
      content: _Content(
        where: ${whereClause}
        limit: $limit
        skip: $skip
        ${orderByClause}
      ) {
        items {
          ...ContentBasic
        }
        total
      }
    }
  `;
}

export function buildGetAncestorsQuery(contentId: string, maxLevels?: number): string {
  return `
    ${CONTENT_METADATA_FRAGMENT}
    
    query GetAncestors {
      content: _Content(
        where: { 
          _or: [
            { _metadata: { key: { eq: "${contentId}" } } }
          ]
        }
        limit: 1
      ) {
        items {
          ...ContentMetadata
          _ancestors(levels: ${maxLevels || 10}) {
            ...ContentMetadata
          }
        }
      }
    }
  `;
}

export function buildFacetedSearchQuery(params: {
  query?: string;
  facets: Record<string, { field: string; limit?: number }>;
  filters?: Record<string, any>;
  limit?: number;
  skip?: number;
  locale?: string;
}): string {
  const whereClause = buildWhereClause({
    searchTerm: params.query,
    filters: params.filters,
    locale: params.locale
  });

  const facetQueries = Object.entries(params.facets)
    .map(([name, config]) => `
      ${name}: facet {
        ${config.field}(limit: ${config.limit || 10}) {
          name
          count
        }
      }
    `).join('\n');

  return `
    ${CONTENT_METADATA_FRAGMENT}
    
    query FacetedSearch(
      $limit: Int = ${params.limit || 20}
      $skip: Int = ${params.skip || 0}
    ) {
      content: _Content(
        where: ${whereClause}
        limit: $limit
        skip: $skip
      ) {
        items {
          ...ContentMetadata
          ... on _IContent {
            _metadata {
              displayName
            }
          }
        }
        total
        facets {
          ${facetQueries}
        }
      }
    }
  `;
}

// Helper functions
function buildWhereClause(params: {
  searchTerm?: string;
  types?: string[];
  locale?: string;
  filters?: Record<string, any>;
}): string {
  const conditions: string[] = [];

  if (params.searchTerm) {
    conditions.push(`_fulltext: { contains: "${params.searchTerm}" }`);
  }

  if (params.types && params.types.length > 0) {
    conditions.push(
      `_metadata: { types: { in: [${params.types.map(t => `"${t}"`).join(', ')}] } }`
    );
  }

  if (params.locale) {
    conditions.push(`_metadata: { locale: { eq: "${params.locale}" } }`);
  }

  if (params.filters) {
    Object.entries(params.filters).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        conditions.push(`${key}: { in: [${value.map(v => JSON.stringify(v)).join(', ')}] }`);
      } else if (typeof value === 'object' && value !== null) {
        // Handle complex filter objects
        const filterStr = Object.entries(value)
          .map(([op, val]) => `${op}: ${JSON.stringify(val)}`)
          .join(', ');
        conditions.push(`${key}: { ${filterStr} }`);
      } else {
        conditions.push(`${key}: { eq: ${JSON.stringify(value)} }`);
      }
    });
  }

  return conditions.length > 0 ? `{ ${conditions.join(', ')} }` : '{}';
}

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