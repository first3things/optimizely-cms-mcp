import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { OptimizelyContentClient } from '../../clients/cma-client.js';
import { GraphConfig, CMAConfig } from '../../types/config.js';
import { handleError, ValidationError } from '../../utils/errors.js';
import { getLogger } from '../../utils/logger.js';
import { z } from 'zod';
import { validateInput, sanitizeInput } from '../../utils/validation.js';

const logger = getLogger();

// Schema for finding content by name
const FindContentByNameSchema = z.object({
  name: z.string().min(1),
  contentType: z.string().optional(),
  limit: z.number().optional().default(10)
});

// Schema for intelligent content creation
const IntelligentCreateSchema = z.object({
  parentName: z.string().min(1),
  contentType: z.string(),
  name: z.string().min(1),
  displayName: z.string().optional(),
  properties: z.record(z.any()).optional(),
  language: z.string().optional().default('en'),
  autoConfirm: z.boolean().optional().default(false)
});

interface ContentSearchResult {
  id: number;
  guid: string;
  name: string;
  path: string;
  contentType: string;
  language?: string;
  url?: string;
}

export async function executeFindContentByName(
  graphConfig: GraphConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const validatedParams = validateInput(FindContentByNameSchema, params);
    const client = new OptimizelyGraphClient(graphConfig);
    
    // Build GraphQL query to search by name
    const query = `
      query FindByName($searchText: String!, $limit: Int) {
        Content(
          where: { 
            _or: [
              { Name: { contains: $searchText } }
              { DisplayName: { contains: $searchText } }
            ]
            ${validatedParams.contentType ? `ContentType: { eq: "${validatedParams.contentType}" }` : ''}
          }
          limit: $limit
          orderBy: { Name: ASC }
        ) {
          items {
            ContentLink {
              Id
              GuidValue
            }
            Name
            DisplayName
            ContentType
            Language {
              Name
              DisplayName
            }
            Url
            RelativePath
            ParentLink {
              Id
              GuidValue
            }
            ... on IContent {
              ParentLink {
                Id
                GuidValue
              }
              Ancestors {
                Name
                ContentLink {
                  Id
                }
              }
            }
          }
          total
        }
      }
    `;
    
    const result = await client.query<any>(query, {
      searchText: validatedParams.name,
      limit: validatedParams.limit
    });
    
    const items = result.Content?.items || [];
    const total = result.Content?.total || 0;
    
    // Format results for easier use
    const formattedResults = items.map((item: any) => ({
      id: item.ContentLink?.Id,
      guid: item.ContentLink?.GuidValue,
      name: item.Name || item.DisplayName,
      displayName: item.DisplayName,
      contentType: item.ContentType?.[0] || item.ContentType,
      language: item.Language?.Name,
      url: item.Url,
      path: item.RelativePath || item.Ancestors?.map((a: any) => a.Name).join(' > '),
      parentGuid: item.ParentLink?.GuidValue
    }));
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          total,
          results: formattedResults,
          message: total > 0 
            ? `Found ${total} content items matching "${validatedParams.name}"`
            : `No content found matching "${validatedParams.name}"`
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeGetContentWithDetails(
  graphConfig: GraphConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const { contentId } = params;
    if (!contentId) {
      throw new ValidationError('Content ID is required');
    }
    
    const client = new OptimizelyGraphClient(graphConfig);
    
    // Query to get full content details including GUID
    const query = `
      query GetContentDetails($id: Int!) {
        Content(where: { ContentLink: { Id: { eq: $id } } }) {
          items {
            ContentLink {
              Id
              GuidValue
            }
            Name
            DisplayName
            ContentType
            Language {
              Name
              DisplayName
            }
            Url
            RelativePath
            ParentLink {
              Id
              GuidValue
            }
            ... on IContent {
              Ancestors {
                Name
                DisplayName
                ContentLink {
                  Id
                  GuidValue
                }
              }
              Children {
                Name
                ContentType
                ContentLink {
                  Id
                }
              }
            }
          }
        }
      }
    `;
    
    const result = await client.query<any>(query, { id: parseInt(contentId.toString()) });
    const content = result.Content?.items?.[0];
    
    if (!content) {
      throw new ValidationError(`Content with ID ${contentId} not found`);
    }
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          content: {
            id: content.ContentLink?.Id,
            guid: content.ContentLink?.GuidValue,
            name: content.Name,
            displayName: content.DisplayName,
            contentType: content.ContentType?.[0] || content.ContentType,
            language: content.Language?.Name,
            url: content.Url,
            path: content.Ancestors?.map((a: any) => a.Name).join(' > '),
            parentGuid: content.ParentLink?.GuidValue,
            hasChildren: content.Children?.length > 0,
            childCount: content.Children?.length || 0
          },
          message: `Retrieved details for "${content.Name}" (GUID: ${content.ContentLink?.GuidValue})`
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeIntelligentCreate(
  graphConfig: GraphConfig,
  cmaConfig: CMAConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const validatedParams = validateInput(IntelligentCreateSchema, params);
    const graphClient = new OptimizelyGraphClient(graphConfig);
    const cmaClient = new OptimizelyContentClient(cmaConfig);
    
    logger.info('Starting intelligent content creation', { parentName: validatedParams.parentName });
    
    // Step 1: Find the parent content by name
    const searchQuery = `
      query FindParent($name: String!) {
        Content(
          where: { 
            _or: [
              { Name: { eq: $name } }
              { DisplayName: { eq: $name } }
              { Name: { contains: $name } }
            ]
          }
          limit: 5
        ) {
          items {
            ContentLink {
              Id
              GuidValue
            }
            Name
            DisplayName
            ContentType
            Url
            RelativePath
            ... on IContent {
              Ancestors {
                Name
              }
            }
          }
          total
        }
      }
    `;
    
    const searchResult = await graphClient.query<any>(searchQuery, { name: validatedParams.parentName });
    const candidates = searchResult.Content?.items || [];
    
    if (candidates.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `No content found with name "${validatedParams.parentName}"`,
            suggestion: "Try using 'content-find-by-name' tool to search for the correct parent content"
          }, null, 2)
        }]
      };
    }
    
    // If multiple candidates, show options
    if (candidates.length > 1 && !validatedParams.autoConfirm) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            requiresSelection: true,
            message: `Found ${candidates.length} items matching "${validatedParams.parentName}". Please be more specific:`,
            options: candidates.map((item: any) => ({
              id: item.ContentLink.Id,
              guid: item.ContentLink.GuidValue,
              name: item.Name,
              displayName: item.DisplayName,
              path: item.Ancestors?.map((a: any) => a.Name).join(' > ') || '/',
              contentType: item.ContentType?.[0] || item.ContentType
            })),
            suggestion: "Use the content ID or be more specific with the parent name"
          }, null, 2)
        }]
      };
    }
    
    // Use the first (or only) match
    const parent = candidates[0];
    const parentGuid = parent.ContentLink.GuidValue;
    const parentPath = parent.Ancestors?.map((a: any) => a.Name).join(' > ') || '/';
    
    // Step 2: Create the content under the found parent
    const createRequest = {
      contentType: validatedParams.contentType,
      name: sanitizeInput(validatedParams.name) as string,
      displayName: validatedParams.displayName || validatedParams.name,
      container: parentGuid,
      language: validatedParams.language,
      properties: sanitizeInput(validatedParams.properties) || {}
    };
    
    logger.info('Creating content', { 
      parent: parent.Name, 
      parentGuid,
      newContent: validatedParams.name 
    });
    
    const createResult = await cmaClient.post('/content', createRequest);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          created: {
            id: createResult.contentLink?.id,
            guid: createResult.contentLink?.guidValue,
            name: createResult.name,
            displayName: createResult.displayName
          },
          parent: {
            id: parent.ContentLink.Id,
            guid: parentGuid,
            name: parent.Name,
            path: `${parentPath} > ${parent.Name}`
          },
          message: `Successfully created "${validatedParams.name}" under "${parent.Name}"`,
          location: `${parentPath} > ${parent.Name} > ${validatedParams.name}`
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeContentWizard(
  graphConfig: GraphConfig,
  cmaConfig: CMAConfig,
  params: any
): Promise<CallToolResult> {
  try {
    // This provides a guided workflow for content creation
    const { step, ...stepParams } = params;
    
    switch (step || 'start') {
      case 'start':
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              wizard: 'content-creation',
              currentStep: 'start',
              message: 'Welcome to the Content Creation Wizard!',
              instructions: [
                "1. First, tell me where you want to create content (e.g., 'under Home' or 'in News section')",
                "2. I'll help you find the right location",
                "3. Then we'll create your content with the right settings"
              ],
              nextStep: {
                tool: 'content-wizard',
                params: {
                  step: 'find-parent',
                  parentName: '<name of parent page>'
                }
              },
              examples: [
                { parentName: 'Home' },
                { parentName: 'News' },
                { parentName: 'About Us' }
              ]
            }, null, 2)
          }]
        };
        
      case 'find-parent':
        if (!stepParams.parentName) {
          throw new ValidationError('Please specify the parent page name');
        }
        
        // Search for parent
        const searchResult = await executeFindContentByName(graphConfig, {
          name: stepParams.parentName,
          limit: 5
        });
        
        // Parse the result to provide next steps
        const searchData = JSON.parse((searchResult as any).content[0].text);
        
        if (searchData.total === 0) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                wizard: 'content-creation',
                currentStep: 'find-parent',
                error: `No content found matching "${stepParams.parentName}"`,
                suggestions: [
                  "Try 'Home' for the home page",
                  "Use 'content-find-by-name' to search for content",
                  "Check the exact spelling of the page name"
                ],
                retry: {
                  tool: 'content-wizard',
                  params: {
                    step: 'find-parent',
                    parentName: '<correct name>'
                  }
                }
              }, null, 2)
            }]
          };
        }
        
        if (searchData.total === 1) {
          // Found exactly one match
          const parent = searchData.results[0];
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                wizard: 'content-creation',
                currentStep: 'confirm-parent',
                parent: {
                  id: parent.id,
                  guid: parent.guid,
                  name: parent.name,
                  path: parent.path,
                  contentType: parent.contentType
                },
                message: `Found: "${parent.name}" at ${parent.path || '/'}`,
                question: "Is this where you want to create content?",
                nextStep: {
                  tool: 'content-wizard',
                  params: {
                    step: 'create-content',
                    parentGuid: parent.guid,
                    parentName: parent.name,
                    contentType: '<type>',
                    name: '<name>',
                    properties: {}
                  }
                },
                contentTypes: ['StandardPage', 'ArticlePage', 'NewsItem', 'BlogPost']
              }, null, 2)
            }]
          };
        }
        
        // Multiple matches
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              wizard: 'content-creation',
              currentStep: 'select-parent',
              message: `Found ${searchData.total} items matching "${stepParams.parentName}"`,
              options: searchData.results.map((r: any) => ({
                id: r.id,
                guid: r.guid,
                name: r.name,
                path: r.path || '/',
                contentType: r.contentType,
                selectThis: {
                  tool: 'content-wizard',
                  params: {
                    step: 'create-content',
                    parentGuid: r.guid,
                    parentName: r.name
                  }
                }
              })),
              instruction: "Choose the correct parent by using the provided tool call"
            }, null, 2)
          }]
        };
        
      case 'create-content':
        if (!stepParams.parentGuid) {
          throw new ValidationError('Parent GUID is required');
        }
        
        if (!stepParams.contentType || !stepParams.name) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                wizard: 'content-creation',
                currentStep: 'content-details',
                parent: {
                  guid: stepParams.parentGuid,
                  name: stepParams.parentName
                },
                message: `Creating content under "${stepParams.parentName}"`,
                required: {
                  contentType: 'Type of content (e.g., StandardPage, ArticlePage)',
                  name: 'Internal name for the content',
                  displayName: 'Display name (optional)',
                  properties: 'Content properties (optional)'
                },
                example: {
                  tool: 'content-wizard',
                  params: {
                    step: 'create-content',
                    parentGuid: stepParams.parentGuid,
                    parentName: stepParams.parentName,
                    contentType: 'StandardPage',
                    name: 'my-new-page',
                    displayName: 'My New Page',
                    properties: {
                      MainBody: '<p>Page content here</p>',
                      Title: 'Welcome to My Page'
                    }
                  }
                }
              }, null, 2)
            }]
          };
        }
        
        // Create the content
        const createRequest = {
          contentType: stepParams.contentType,
          name: sanitizeInput(stepParams.name) as string,
          displayName: stepParams.displayName || stepParams.name,
          container: stepParams.parentGuid,
          language: stepParams.language || 'en',
          properties: sanitizeInput(stepParams.properties) || {}
        };
        
        const cmaClient = new OptimizelyContentClient(cmaConfig);
        const result = await cmaClient.post('/content', createRequest);
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              wizard: 'content-creation',
              currentStep: 'complete',
              success: true,
              created: {
                id: result.contentLink?.id,
                guid: result.contentLink?.guidValue,
                name: result.name,
                displayName: result.displayName
              },
              parent: {
                guid: stepParams.parentGuid,
                name: stepParams.parentName
              },
              message: `✅ Successfully created "${stepParams.name}" under "${stepParams.parentName}"!`,
              nextSteps: [
                "You can now update the content properties",
                "Publish the content when ready",
                "Create more content in the same location"
              ]
            }, null, 2)
          }]
        };
        
      default:
        throw new ValidationError(`Unknown wizard step: ${step}`);
    }
  } catch (error) {
    return handleError(error);
  }
}