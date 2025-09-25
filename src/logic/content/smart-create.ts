import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { OptimizelyContentClient } from '../../clients/cma-client.js';
import { GraphConfig, CMAConfig } from '../../types/config.js';
import { handleError } from '../../utils/errors.js';
import { getLogger } from '../../utils/logger.js';
import { z } from 'zod';
import { validateInput, sanitizeInput } from '../../utils/validation.js';
import { AdapterRegistry } from '../../adapters/registry.js';

const logger = getLogger();

// Common parent page names - this is still reasonable as it's not CMS-specific
const COMMON_PARENT_NAMES = ['Home', 'Start', 'Root', 'Front Page', 'Index'];

const SmartCreateSchema = z.object({
  contentType: z.string().nullable().optional(),
  suggestedType: z.string().optional(),
  name: z.string(),
  displayName: z.string().optional(),
  parentId: z.union([z.string(), z.number()]).nullable().optional(),
  parentName: z.string().optional(),
  container: z.string().optional(),
  properties: z.record(z.any()).optional(),
  language: z.string().optional().default('en')
});

async function findContentTypeMatch(
  adapter: any,
  requestedType: string | null | undefined
): Promise<string | null> {
  if (!requestedType) return null;
  
  try {
    // Get all available content types from the adapter
    const contentTypes = await adapter.getContentTypes();
    
    const normalized = requestedType.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // First try exact match (case-insensitive)
    const exactMatch = contentTypes.find(ct => 
      ct.key.toLowerCase() === requestedType.toLowerCase()
    );
    if (exactMatch) return exactMatch.key;
    
    // Try normalized match
    const normalizedMatch = contentTypes.find(ct => 
      ct.key.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized
    );
    if (normalizedMatch) return normalizedMatch.key;
    
    // Try partial match based on category and keywords
    const keywordMatch = contentTypes.find(ct => {
      const ctNormalized = ct.key.toLowerCase();
      const displayNormalized = ct.displayName?.toLowerCase() || '';
      
      // Check if the requested type is contained in the actual type
      return ctNormalized.includes(normalized) || 
             displayNormalized.includes(normalized) ||
             normalized.includes(ctNormalized.replace('page', ''));
    });
    if (keywordMatch) return keywordMatch.key;
    
    // If looking for article/blog/news, prefer page types with those keywords
    if (['article', 'blog', 'news', 'post'].some(keyword => normalized.includes(keyword))) {
      const articleType = contentTypes.find(ct => 
        ct.category === 'page' && 
        (ct.key.toLowerCase().includes('article') || 
         ct.key.toLowerCase().includes('blog') ||
         ct.key.toLowerCase().includes('news'))
      );
      if (articleType) return articleType.key;
    }
    
    // Default to a standard page type if available
    const standardPage = contentTypes.find(ct => 
      ct.category === 'page' && 
      (ct.key.toLowerCase().includes('standard') || ct.key === 'Page')
    );
    if (standardPage) return standardPage.key;
    
    // Return any page type as last resort
    const anyPage = contentTypes.find(ct => ct.category === 'page');
    if (anyPage) return anyPage.key;
    
  } catch (error) {
    logger.warn('Failed to get content types for matching', error);
  }
  
  return null;
}

async function findParentByName(
  graphClient: OptimizelyGraphClient,
  parentName?: string
): Promise<{ id: number; guid: string; name: string } | null> {
  // If no parent name provided, search for common root pages
  const searchNames = parentName ? [parentName] : COMMON_PARENT_NAMES;
  
  for (const name of searchNames) {
    try {
      const query = `
        query FindParent($name: String!) {
          _Content(
            where: { 
              _metadata: { 
                displayName: { eq: $name }
              }
            }
            limit: 1
          ) {
            items {
              _metadata {
                key
                displayName
              }
            }
          }
        }
      `;
      
      const result = await graphClient.query<any>(query, { name });
      
      if (result._Content?.items?.length > 0) {
        const item = result._Content.items[0];
        return {
          id: 0, // Optimizely Graph doesn't return numeric IDs
          guid: item._metadata.key,
          name: item._metadata.displayName
        };
      }
    } catch (error) {
      logger.warn(`Failed to find parent with name "${name}"`, error);
    }
  }
  
  return null;
}

export async function executeSmartContentCreate(
  graphConfig: GraphConfig,
  cmaConfig: CMAConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const validatedParams = validateInput(SmartCreateSchema, params);
    
    const graphClient = new OptimizelyGraphClient(graphConfig);
    // Note: We'll use executeContentCreate for creation, so cmaClient is only for fallback
    
    // Get the adapter for intelligent type discovery
    const registry = AdapterRegistry.getInstance();
    const adapter = registry.getOptimizelyAdapter(cmaConfig);
    
    logger.info('Smart content creation started', { 
      requestedType: validatedParams.contentType,
      parentId: validatedParams.parentId,
      parentName: validatedParams.parentName
    });
    
    // Step 1: Determine content type using intelligent discovery
    let contentType = validatedParams.contentType;
    
    if (!contentType || contentType === 'null') {
      // Try to infer from suggested type
      contentType = await findContentTypeMatch(adapter, validatedParams.suggestedType);
      
      if (!contentType) {
        // Get available content types for error message
        const types = await adapter.getContentTypes();
        const pageTypes = types.filter(t => t.category === 'page').map(t => t.key);
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'Could not determine content type',
              suggestedType: validatedParams.suggestedType,
              availablePageTypes: pageTypes.slice(0, 5),
              suggestion: 'Please specify a valid contentType parameter',
              example: { contentType: pageTypes[0] || 'Page' }
            }, null, 2)
          }]
        };
      }
      
      logger.info('Inferred content type', { contentType });
    } else {
      // Try to find the correct content type name
      const matchedType = await findContentTypeMatch(adapter, contentType);
      if (matchedType) {
        contentType = matchedType;
        logger.info('Matched content type', { original: validatedParams.contentType, matched: contentType });
      }
    }
    
    // Step 2: Determine parent container
    let containerGuid: string | null = null;
    
    // Check if container GUID is already provided
    if (validatedParams.container) {
      containerGuid = validatedParams.container;
    }
    // Try to parse parentId as GUID
    else if (validatedParams.parentId && typeof validatedParams.parentId === 'string') {
      const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (guidRegex.test(validatedParams.parentId)) {
        containerGuid = validatedParams.parentId;
      }
    }
    
    // If no container GUID yet, try to find parent by name
    if (!containerGuid) {
      const parent = await findParentByName(
        graphClient, 
        validatedParams.parentName || undefined
      );
      
      if (parent) {
        containerGuid = parent.guid;
        logger.info('Found parent container', { 
          name: parent.name, 
          guid: parent.guid 
        });
      }
    }
    
    // If still no container, return helpful error
    if (!containerGuid) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Could not find parent container',
            message: 'Unable to automatically find a parent page. Searched for: ' + 
                    (validatedParams.parentName || COMMON_PARENT_NAMES.join(', ')),
            suggestions: [
              'Use content_find_by_name to search for the parent page',
              'Specify parentName with the exact page name',
              'Provide container GUID directly',
              'Check if your site has pages named: Home, Start, or Root'
            ],
            alternativeTools: [
              {
                tool: 'content_find_by_name',
                description: 'Search for pages by name to get their GUIDs'
              },
              {
                tool: 'content_create_under',
                description: 'Create content under a parent by name'
              }
            ]
          }, null, 2)
        }]
      };
    }
    
    // Step 3: Create the content
    // Convert name to URL-safe format if needed
    let contentName = sanitizeInput(validatedParams.name) as string;
    if (contentName && contentName.includes(' ')) {
      // Convert to URL-safe name: lowercase, replace spaces with hyphens
      contentName = contentName.toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
    }
    
    const createRequest = {
      contentType,
      name: contentName,
      displayName: validatedParams.displayName || validatedParams.name,
      container: containerGuid,
      language: validatedParams.language,
      properties: sanitizeInput(validatedParams.properties) || {}
    };
    
    logger.info('Creating content', createRequest);
    
    try {
      const result = await cmaClient.post('/experimental/content', createRequest);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            created: {
              id: result.contentLink?.id,
              guid: result.contentLink?.guidValue,
              name: result.name,
              displayName: result.displayName,
              contentType
            },
            parent: {
              guid: containerGuid
            },
            message: `Successfully created "${validatedParams.name}" as ${contentType}`
          }, null, 2)
        }]
      };
    } catch (error: any) {
      // If content type doesn't exist, try to find a fallback
      if (error.status === 400) {
        logger.warn('Content creation failed, attempting intelligent fallback', { 
          failedType: contentType 
        });
        
        // Get available types and suggest alternatives
        try {
          const types = await adapter.getContentTypes();
          const pageTypes = types.filter(t => t.category === 'page');
          
          // Try to find a suitable fallback
          let fallbackType = pageTypes.find(t => 
            t.key.toLowerCase().includes('standard') || 
            t.key === 'Page'
          )?.key;
          
          if (!fallbackType && pageTypes.length > 0) {
            fallbackType = pageTypes[0].key;
          }
          
          if (fallbackType) {
            createRequest.contentType = fallbackType;
            const result = await cmaClient.post('/experimental/content', createRequest);
            
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  created: {
                    id: result.contentLink?.id,
                    guid: result.contentLink?.guidValue,
                    name: result.name,
                    displayName: result.displayName,
                    contentType: fallbackType
                  },
                  parent: {
                    guid: containerGuid
                  },
                  message: `Created as ${fallbackType} (${contentType} was not available)`,
                  note: `Available page types: ${pageTypes.map(t => t.key).join(', ')}`
                }, null, 2)
              }]
            };
          }
        } catch (fallbackError) {
          logger.error('Failed to find fallback type', fallbackError);
        }
      }
      
      throw error;
    }
  } catch (error) {
    return handleError(error);
  }
}