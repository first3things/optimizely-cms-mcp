import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { OptimizelyContentClient } from '../../clients/cma-client.js';
import { GraphConfig, CMAConfig } from '../../types/config.js';
import { handleError, ValidationError } from '../../utils/errors.js';
import { getLogger } from '../../utils/logger.js';
import { z } from 'zod';
import { validateInput, sanitizeInput } from '../../utils/validation.js';
import { AdapterRegistry } from '../../adapters/registry.js';
import { IntelligentFieldPopulator } from './intelligent-populator.js';
import { SchemaFieldDiscovery } from './schema-field-discovery.js';

// Safe JSON parser to handle non-JSON responses
function safeJsonParse(text: string): { ok: boolean; data: any } {
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, data: text };
  }
}

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

// Removed unused interface ContentSearchResult

export async function executeFindContentByName(
  graphConfig: GraphConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const validatedParams = validateInput(FindContentByNameSchema, params);
    const client = new OptimizelyGraphClient(graphConfig);
    
    // Build GraphQL query to search by name - using actual schema fields
    const query = `
      query FindByName($searchText: String!, $limit: Int) {
        _Content(
          where: { 
            _metadata: { 
              displayName: { contains: $searchText }
              ${validatedParams.contentType ? `types: { contains: "${validatedParams.contentType}" }` : ''}
            }
          }
          limit: $limit
          orderBy: { _metadata: { displayName: ASC } }
        ) {
          items {
            _metadata {
              key
              displayName
              types
              locale
              url {
                hierarchical
              }
              status
              created
              lastModified
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
    
    const items = result._Content?.items || [];
    const total = result._Content?.total || 0;
    
    // Format results for easier use
    const formattedResults = items.map((item: any) => ({
      guid: item._metadata?.key,
      name: item._metadata?.displayName,
      displayName: item._metadata?.displayName,
      contentType: item._metadata?.types?.[0] || (Array.isArray(item._metadata?.types) ? item._metadata?.types.join(', ') : item._metadata?.types),
      language: item._metadata?.locale,
      url: item._metadata?.url?.hierarchical,
      path: item._metadata?.url?.hierarchical,
      status: item._metadata?.status,
      created: item._metadata?.created,
      lastModified: item._metadata?.lastModified
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
    
    // Query to get full content details including GUID - using actual schema
    const query = `
      query GetContentDetails($id: String!) {
        _Content(where: { 
          _metadata: { key: { eq: $id } }
        }) {
          items {
            _metadata {
              key
              displayName
              types
              locale
              url {
                hierarchical
              }
              status
              created
              lastModified
              sortOrder
            }
          }
        }
      }
    `;
    
    const result = await client.query<any>(query, { id: contentId.toString() });
    const content = result._Content?.items?.[0];
    
    if (!content) {
      throw new ValidationError(`Content with ID ${contentId} not found`);
    }
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          content: {
            guid: content._metadata?.key,
            name: content._metadata?.displayName,
            displayName: content._metadata?.displayName,
            contentType: content._metadata?.types?.[0] || content._metadata?.types,
            language: content._metadata?.locale,
            url: content._metadata?.url?.hierarchical,
            path: content._metadata?.url?.hierarchical,
            status: content._metadata?.status,
            created: content._metadata?.created,
            lastModified: content._metadata?.lastModified,
            sortOrder: content._metadata?.sortOrder
          },
          message: `Retrieved details for "${content._metadata?.displayName}" (GUID: ${content._metadata?.key})`
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
    
    // Step 1: Find the parent content by name - using dynamic query builder
    const { createIntelligentQueryBuilder } = await import('../graph/intelligent-query-builder.js');
    const queryBuilder = await createIntelligentQueryBuilder(graphConfig);
    
    // Build a dynamic search query that doesn't assume specific fields exist
    const searchQuery = await queryBuilder.buildSearchQuery({
      searchTerm: validatedParams.parentName,
      limit: 5,
      options: {
        includeMetadata: true,
        maxDepth: 1
      }
    });
    
    const searchResult = await graphClient.query<any>(searchQuery, { 
      limit: 5,
      skip: 0 
    });
    
    // Access results dynamically based on what's returned
    const items = searchResult.content?.items || searchResult._Content?.items || [];
    
    if (items.length === 0) {
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
    if (items.length > 1 && !validatedParams.autoConfirm) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            requiresSelection: true,
            message: `Found ${items.length} items matching "${validatedParams.parentName}". Please be more specific:`,
            options: items.map((item: any) => ({
              // Use dynamic field access instead of hardcoded paths
              guid: item._metadata?.key,
              displayName: item._metadata?.displayName,
              types: item._metadata?.types,
              url: item._metadata?.url?.hierarchical,
              locale: item._metadata?.locale
            })),
            suggestion: "Use the content GUID or be more specific with the parent name"
          }, null, 2)
        }]
      };
    }
    
    // Use the first (or only) match
    const parent = items[0];
    const parentGuid = parent._metadata?.key;
    if (!parentGuid) {
      throw new ValidationError('Selected parent content does not have a valid GUID/key');
    }
    
    // Step 2: First discover the schema and available fields
    const fieldDiscovery = new SchemaFieldDiscovery(cmaConfig);
    
    // Show field guide in response
    let fieldGuide = '';
    try {
      fieldGuide = await fieldDiscovery.getFieldGuide(validatedParams.contentType);
    } catch (error) {
      logger.warn('Could not fetch field guide:', error);
    }
    
    // Step 3: Create the content under the found parent using the CRUD function
    // Import and use the CRUD function which now handles dynamic field mapping
    const { executeContentCreate } = await import('./crud.js');
    
    const createParams = {
      contentType: validatedParams.contentType,
      name: sanitizeInput(validatedParams.name) as string,
      displayName: validatedParams.displayName || validatedParams.name,
      container: parentGuid,
      language: validatedParams.language,
      properties: sanitizeInput(validatedParams.properties) || {}
    };
    
    logger.info('Creating content with dynamic field mapping', { 
      parent: parent.Name, 
      parentGuid,
      newContent: validatedParams.name,
      providedFields: Object.keys(createParams.properties)
    });
    
    const createResponse = await executeContentCreate(cmaConfig, createParams);
    
    // Parse the response
    if (createResponse.isError) {
      return createResponse; // Return the error as-is
    }
    
    const createResultText = (createResponse.content?.[0] as any)?.text || '{}';
    const createResult = JSON.parse(createResultText).content || {};
    
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
            guid: parentGuid,
            displayName: parent._metadata?.displayName,
            types: parent._metadata?.types,
            url: parent._metadata?.url?.hierarchical
          },
          message: `Successfully created "${validatedParams.name}" under "${parent._metadata?.displayName || 'parent'}"`,
          location: parent._metadata?.url?.hierarchical ? `${parent._metadata.url.hierarchical}/${validatedParams.name}` : validatedParams.name,
          fieldGuide: fieldGuide ? `\n\nField Guide:\n${fieldGuide}` : undefined,
          tip: fieldGuide ? undefined : 'Use type-get-schema to discover available fields for this content type'
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
        let searchResult;
        try {
          searchResult = await executeFindContentByName(graphConfig, {
            name: stepParams.parentName,
            limit: 5
          });
        } catch (error) {
          // Handle upstream errors
          return {
            isError: true,
            content: [
              { type: 'text', text: 'Content wizard failed while finding parent.' },
              { type: 'text', text: `Error: ${(error as any).message || error}` }
            ]
          };
        }
        
        // Parse the result with safe parser
        const searchResultText = (searchResult as any).content?.[0]?.text || '';
        const searchParsed = safeJsonParse(searchResultText);
        
        if (!searchParsed.ok) {
          // Return structured MCP error
          return {
            isError: true,
            content: [
              { type: 'text', text: 'Content wizard failed while finding parent.' },
              { type: 'text', text: typeof searchParsed.data === 'string' ? searchParsed.data : JSON.stringify(searchParsed.data) }
            ]
          };
        }
        
        const searchData = searchParsed.data;
        
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
                contentTypes: 'Use type-discover to see available types in your CMS',
                tip: 'Use step="preview-content" to see available fields for the content type'
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
        
      case 'preview-content':
        if (!stepParams.parentGuid || !stepParams.contentType || !stepParams.name) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                wizard: 'content-creation',
                currentStep: 'preview-error',
                error: 'Missing required parameters for preview',
                required: {
                  parentGuid: 'Parent GUID',
                  contentType: 'Content type',
                  name: 'Content name'
                }
              }, null, 2)
            }]
          };
        }
        
        // Use schema discovery to show actual available fields
        const schemaDiscovery = new SchemaFieldDiscovery(cmaConfig);
        
        let fieldGuide;
        let discoveryResult;
        try {
          fieldGuide = await schemaDiscovery.getFieldGuide(stepParams.contentType);
          discoveryResult = await schemaDiscovery.discoverFields(
            stepParams.contentType,
            stepParams.properties || {}
          );
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                wizard: 'content-creation',
                currentStep: 'preview-error',
                error: `Content type '${stepParams.contentType}' not found`
              }, null, 2)
            }]
          };
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              wizard: 'content-creation',
              currentStep: 'preview',
              contentType: {
                name: discoveryResult.schema.name,
                displayName: discoveryResult.schema.displayName
              },
              fieldGuide: fieldGuide,
              willCreate: {
                name: stepParams.name,
                displayName: stepParams.displayName || stepParams.name,
                container: stepParams.parentGuid,
                parentName: stepParams.parentName
              },
              providedFields: Object.keys(stepParams.properties || {}),
              availableFields: discoveryResult.availableFields,
              requiredFields: discoveryResult.schema.requiredFields,
              fieldMappingSuggestions: discoveryResult.suggestions,
              proceedToCreate: {
                tool: 'content-wizard',
                params: {
                  ...stepParams,
                  step: 'create-content'
                }
              },
              tip: 'Review the field guide above to see all available fields for this content type'
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
                  contentType: 'Type of content from your CMS',
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
                    contentType: '[YourContentType]',
                    name: 'my-new-page',
                    displayName: 'My New Page',
                    properties: {
                      '[YourContentField]': '<p>Page content here</p>',
                      Title: 'Welcome to My Page'
                    }
                  }
                },
                tip: 'Use content_type_analyzer to understand required fields for your content type'
              }, null, 2)
            }]
          };
        }
        
        // Use schema discovery for dynamic field mapping
        logger.info(`Content wizard: Discovering fields for ${stepParams.contentType}`);
        
        const fieldDiscovery = new SchemaFieldDiscovery(cmaConfig);
        
        // Prepare initial properties
        const userProperties = sanitizeInput(stepParams.properties) || {};
        
        logger.info('Content wizard: User provided properties', {
          userProperties,
          propertyKeys: Object.keys(userProperties)
        });
        
        // Dynamically map fields based on actual schema
        let mappingResult;
        try {
          mappingResult = await fieldDiscovery.mapFieldsDynamically(
            stepParams.contentType,
            userProperties
          );
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                wizard: 'content-creation',
                currentStep: 'error',
                error: `Content type '${stepParams.contentType}' not found`,
                availableTypes: 'Use type-discover to see available types in your CMS',
                retry: {
                  tool: 'content-wizard',
                  params: {
                    ...stepParams,
                    contentType: '<valid-type>'
                  }
                }
              }, null, 2)
            }]
          };
        }
        
        logger.info('Content wizard: Dynamic field mapping result', {
          mappedProperties: mappingResult.mappedProperties,
          unmappedFields: mappingResult.unmappedFields,
          suggestions: mappingResult.mappingSuggestions
        });
        
        // Use intelligent population to fill any missing required fields
        const registry = AdapterRegistry.getInstance();
        const adapter = registry.getOptimizelyAdapter(cmaConfig);
        const populator = new IntelligentFieldPopulator(adapter);
        
        const populationContext = {
          contentType: stepParams.contentType,
          displayName: stepParams.displayName || stepParams.name,
          properties: mappingResult.mappedProperties,
          container: stepParams.parentGuid,
          locale: stepParams.language || 'en'
        };
        
        const populationResult = await populator.populateRequiredFields(populationContext);
        
        // Log field population details
        if (populationResult.suggestions.length > 0 || populationResult.missingRequired.length > 0) {
          logger.info('Content wizard field population:', {
            suggestions: populationResult.suggestions,
            missingRequired: populationResult.missingRequired
          });
        }
        
        logger.info('Content wizard: Final populated properties', {
          populatedProperties: populationResult.populatedProperties,
          propertyCount: Object.keys(populationResult.populatedProperties).length
        });
        
        // Create the content using the CRUD function with intelligently populated fields
        const createParams = {
          contentType: stepParams.contentType,
          name: sanitizeInput(stepParams.name) as string,
          displayName: stepParams.displayName || stepParams.name,
          container: stepParams.parentGuid,
          language: stepParams.language || 'en',
          properties: populationResult.populatedProperties
        };
        
        // Import and use the CRUD function
        const { executeContentCreate } = await import('./crud.js');
        const createResult = await executeContentCreate(cmaConfig, createParams);
        
        // Check if creation failed
        if (createResult.isError) {
          return createResult; // Return the structured error
        }
        
        // Parse the success result
        const createResultText = (createResult.content?.[0] as any)?.text || '{}';
        const createParsed = safeJsonParse(createResultText);
        const result = createParsed.ok ? createParsed.data : { success: true, content: {} };
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              wizard: 'content-creation',
              currentStep: 'complete',
              success: true,
              created: result.content || {
                name: stepParams.name,
                displayName: stepParams.displayName || stepParams.name
              },
              parent: {
                guid: stepParams.parentGuid,
                name: stepParams.parentName
              },
              message: result.message || `✅ Successfully created "${stepParams.name}" under "${stepParams.parentName}"!`,
              fieldMappings: mappingResult.mappingSuggestions.length > 0 ?
                mappingResult.mappingSuggestions.map(s => `${s.userField} → ${s.suggestedField} (${s.reason})`) :
                ['All fields mapped directly'],
              fieldsPopulated: populationResult.suggestions.length > 0 ? 
                populationResult.suggestions.map(s => `${s.field}: ${s.message}`) : 
                ['All required fields provided'],
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
  } catch (error: any) {
    // Return structured MCP error for wizard
    return {
      isError: true,
      content: [
        { type: 'text', text: 'Content wizard encountered an error.' },
        { type: 'text', text: `Step: ${params.step || 'unknown'}` },
        { type: 'text', text: `Error: ${error.message || error}` }
      ]
    };
  }
}