import { getLogger } from '../../utils/logger.js';

/**
 * Simple, working GraphQL query builder for Optimizely Graph
 * 
 * This builder focuses on generating valid, working queries
 * without complex introspection or dynamic field generation.
 */
export class SimpleQueryBuilder {
  private logger = getLogger();

  /**
   * Build a simple search query
   * Example: Search for "home" to find homepage
   */
  buildSearchQuery(searchTerm: string, limit: number = 20): string {
    const query = `
      query SearchContent($searchTerm: String!, $limit: Int!) {
        _Content(
          where: {
            _or: [
              { _fulltext: { match: $searchTerm } },
              { _metadata: { displayName: { contains: $searchTerm } } }
            ]
          }
          limit: $limit
          orderBy: { _ranking: RELEVANCE }
        ) {
          items {
            __typename
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
              lastModified
            }
            _score
          }
          total
        }
      }
    `;
    
    return this.cleanQuery(query);
  }

  /**
   * Get content by ID/key
   * Example: "fe8be9de-7160-48a8-a16f-5fcdd25b04f9"
   */
  buildGetContentQuery(id: string, includeFields?: string[]): string {
    // Extract just the GUID if the ID has suffixes
    const key = id.split('_')[0];
    
    // Build field selections if requested
    let additionalFields = '';
    if (includeFields && includeFields.length > 0) {
      // Add fields using generic _IContent interface
      // This works for any content type without hardcoding
      additionalFields = `
            ... on _IContent {
              ${this.buildFieldSelection(includeFields)}
            }`;
    }
    
    const query = `
      query GetContent($key: String!) {
        _Content(
          where: {
            _metadata: { key: { eq: $key } }
          }
          limit: 1
        ) {
          items {
            __typename
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
              lastModified
              status
            }${additionalFields}
          }
        }
      }
    `;
    
    return this.cleanQuery(query);
  }

  /**
   * Build field selection handling complex types
   */
  private buildFieldSelection(fields: string[]): string {
    return fields.map(field => {
      // Handle nested fields like ParentObject.ChildField
      if (field.includes('.')) {
        const parts = field.split('.');
        const parent = parts[0];
        const children = parts.slice(1).join('.');
        return `${parent} { ${children} }`;
      }
      
      // Handle complex fields based on patterns, not hardcoded names
      const lowerField = field.toLowerCase();
      
      // Rich text fields - let GraphQL handle the structure
      if (lowerField.includes('richtext') || lowerField.includes('body') || lowerField.includes('content')) {
        return `${field}`;  // Just the field name, let GraphQL handle the error
      }
      
      // Image/media fields - common pattern is to have URL structure
      if (lowerField.includes('image') || lowerField.includes('media') || lowerField.includes('photo')) {
        return `${field} { url { default } }`;
      }
      
      // SEO-related fields - use ellipsis to discover structure
      if (lowerField.includes('seo') || lowerField.includes('meta')) {
        return `${field} { ... }`;
      }
      
      // Simple fields
      return field;
    }).join('\n              ');
  }

  /**
   * Get content by path
   * Example: "/" for homepage, "/articles/my-article" for specific page
   */
  buildGetContentByPathQuery(path: string, locale: string = 'en'): string {
    // Ensure path starts with /
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    
    const query = `
      query GetContentByPath($path: String!, $locale: String!) {
        _Content(
          where: {
            _and: [
              { _metadata: { url: { hierarchical: { eq: $path } } } },
              { _metadata: { locale: { eq: $locale } } }
            ]
          }
          limit: 1
        ) {
          items {
            __typename
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
              lastModified
              status
            }
          }
        }
      }
    `;
    
    return this.cleanQuery(query);
  }

  /**
   * Build a custom query - just ensure it's clean
   */
  buildCustomQuery(query: string): string {
    return this.cleanQuery(query);
  }

  /**
   * Get schema introspection
   */
  buildIntrospectionQuery(): string {
    const query = `
      query IntrospectSchema {
        __schema {
          queryType {
            name
          }
          types {
            name
            kind
            description
          }
        }
      }
    `;
    
    return this.cleanQuery(query);
  }

  /**
   * Clean and validate query
   */
  private cleanQuery(query: string): string {
    // Just trim the overall query, preserve internal formatting
    const cleaned = query.trim();
    
    // Basic validation - ensure no empty field selections
    if (cleaned.includes('{}') || cleaned.includes('{ }')) {
      this.logger.warn('Query contains empty field selections');
    }
    
    return cleaned;
  }

  /**
   * Generate variables for search query
   */
  getSearchVariables(searchTerm: string, limit: number = 20): Record<string, any> {
    return {
      searchTerm,
      limit
    };
  }

  /**
   * Generate variables for get content query
   */
  getContentVariables(id: string): Record<string, any> {
    // Extract just the GUID if the ID has suffixes
    const key = id.split('_')[0];
    return {
      key
    };
  }

  /**
   * Generate variables for get by path query
   */
  getPathVariables(path: string, locale: string = 'en'): Record<string, any> {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return {
      path: normalizedPath,
      locale
    };
  }
}