import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { OptimizelyContentClient } from '../../clients/cma-client.js';
import { GraphConfig, CMAConfig } from '../../types/config.js';
import { handleError, ValidationError } from '../../utils/errors.js';
import { getLogger } from '../../utils/logger.js';
import { z } from 'zod';
import { validateInput, sanitizeInput } from '../../utils/validation.js';

const logger = getLogger();

// Common content type mappings
const CONTENT_TYPE_MAPPINGS: Record<string, string[]> = {
  'article': ['ArticlePage', 'Article', 'ArticlePageType', 'BlogPost', 'NewsArticle'],
  'page': ['StandardPage', 'Page', 'ContentPage', 'BasicPage'],
  'standard': ['StandardPage', 'Page'],
  'blog': ['BlogPost', 'BlogPage', 'BlogArticle'],
  'news': ['NewsPage', 'NewsArticle', 'NewsItem'],
  'product': ['ProductPage', 'Product', 'ProductDetail'],
  'landing': ['LandingPage', 'CampaignPage'],
  'home': ['HomePage', 'StartPage', 'FrontPage'],
  'start': ['StartPage', 'HomePage', 'FrontPage']
};

// Common parent page names
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
  graphClient: OptimizelyGraphClient,
  requestedType: string | null | undefined
): Promise<string | null> {
  if (!requestedType) return null;
  
  const normalized = requestedType.toLowerCase().replace(/[^a-z]/g, '');
  
  // Check mappings
  for (const [key, types] of Object.entries(CONTENT_TYPE_MAPPINGS)) {
    if (normalized.includes(key)) {
      // Try to find which type exists in the system
      for (const type of types) {
        // For now, just return the first match
        // In production, we'd query to verify it exists
        return type;
      }
    }
  }
  
  // Try exact match with different cases
  const variations = [
    requestedType,
    requestedType.charAt(0).toUpperCase() + requestedType.slice(1),
    requestedType.replace(/\s+/g, ''),
    requestedType.replace(/\s+/g, '') + 'Page',
    requestedType.replace(/page/i, 'Page')
  ];
  
  for (const variation of variations) {
    // In production, verify this type exists
    if (variation) return variation;
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
    const cmaClient = new OptimizelyContentClient(cmaConfig);
    
    logger.info('Smart content creation started', { 
      requestedType: validatedParams.contentType,
      parentId: validatedParams.parentId,
      parentName: validatedParams.parentName
    });
    
    // Step 1: Determine content type
    let contentType = validatedParams.contentType;
    
    if (!contentType || contentType === 'null') {
      // Try to infer from suggested type or default to StandardPage
      contentType = validatedParams.suggestedType || 
                   await findContentTypeMatch(graphClient, validatedParams.suggestedType) ||
                   'StandardPage';
      
      logger.info('Inferred content type', { contentType });
    } else {
      // Try to find the correct content type name
      const matchedType = await findContentTypeMatch(graphClient, contentType);
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
      const result = await cmaClient.post('/content', createRequest);
      
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
      // If content type doesn't exist, try fallback
      if (error.status === 400 && contentType !== 'StandardPage') {
        logger.warn('Content type might not exist, trying StandardPage', { 
          failedType: contentType 
        });
        
        createRequest.contentType = 'StandardPage';
        const result = await cmaClient.post('/content', createRequest);
        
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
                contentType: 'StandardPage'
              },
              parent: {
                guid: containerGuid
              },
              message: `Created as StandardPage (${contentType} might not exist)`,
              note: 'The requested content type might not exist in your Optimizely instance'
            }, null, 2)
          }]
        };
      }
      
      throw error;
    }
  } catch (error) {
    return handleError(error);
  }
}