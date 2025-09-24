import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OptimizelyContentClient } from '../../clients/cma-client.js';
import { CMAConfig } from '../../types/config.js';
import { 
  ContentItem, 
  CreateContentRequest, 
  UpdateContentRequest,
  MoveContentRequest,
  CopyContentRequest,
  ContentReference
} from '../../types/optimizely.js';
import { handleError, ValidationError } from '../../utils/errors.js';
import { validateInput, sanitizeInput } from '../../utils/validation.js';
import { z } from 'zod';

// Validation schemas
// Removed unused ContentReferenceSchema

const CreateContentSchema = z.object({
  contentType: z.union([z.string(), z.array(z.string())]),
  name: z.string().min(1),
  displayName: z.string().min(1).optional(),
  properties: z.record(z.any()).optional(),
  parentId: z.union([z.string(), z.number()]).optional(),
  container: z.string().optional(), // GUID of parent container
  language: z.string().optional().default('en')
});

const UpdateContentSchema = z.object({
  contentId: z.union([z.string(), z.number()]),
  properties: z.record(z.any()).optional(),
  name: z.string().optional(),
  language: z.string().optional(),
  createVersion: z.boolean().optional()
});

const PatchContentSchema = z.object({
  contentId: z.union([z.string(), z.number()]),
  patches: z.array(z.object({
    op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
    path: z.string().regex(/^\/[a-zA-Z0-9_/]+$/),
    value: z.any().optional(),
    from: z.string().optional()
  })),
  language: z.string().optional()
});

const DeleteContentSchema = z.object({
  contentId: z.union([z.string(), z.number()]),
  permanent: z.boolean().optional().default(false),
  includeDescendants: z.boolean().optional().default(false)
});

const MoveContentSchema = z.object({
  contentId: z.union([z.string(), z.number()]),
  targetId: z.union([z.string(), z.number()]),
  createRedirect: z.boolean().optional().default(false)
});

const CopyContentSchema = z.object({
  contentId: z.union([z.string(), z.number()]),
  targetId: z.union([z.string(), z.number()]),
  includeDescendants: z.boolean().optional().default(false),
  newName: z.string().optional()
});

// Helper function to parse content reference
function parseContentReference(id: string | number): ContentReference {
  if (typeof id === 'number') {
    return { id };
  }
  
  // Check if it's a GUID
  const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (guidRegex.test(id)) {
    return { guidValue: id };
  }
  
  // Try to parse as number
  const numId = parseInt(id, 10);
  if (!isNaN(numId)) {
    return { id: numId };
  }
  
  // Assume it's a string key
  throw new ValidationError(`Invalid content reference: ${id}`);
}

export async function executeContentCreate(
  config: CMAConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const validatedParams = validateInput(CreateContentSchema, params);
    const client = new OptimizelyContentClient(config);
    
    // Prepare the request according to CMA API requirements
    const request: any = {
      contentType: Array.isArray(validatedParams.contentType) 
        ? validatedParams.contentType[0] 
        : validatedParams.contentType,
      name: sanitizeInput(validatedParams.name) as string,
      displayName: validatedParams.displayName || validatedParams.name,
      language: validatedParams.language || 'en'
    };

    // Handle properties
    if (validatedParams.properties) {
      request.properties = sanitizeInput(validatedParams.properties);
    }
    
    // Handle parent container - CMA API requires either 'container' or 'owner'
    if (validatedParams.container) {
      request.container = validatedParams.container;
    } else if (validatedParams.parentId) {
      // Try to parse parentId as GUID or convert to container reference
      const parentRef = parseContentReference(validatedParams.parentId);
      if (parentRef.guidValue) {
        request.container = parentRef.guidValue;
      } else {
        throw new ValidationError(
          'Parent must be specified as a GUID. The Content Management API requires a valid container GUID.\n' +
          'Example: "container": "12345678-1234-1234-1234-123456789012"\n' +
          'To find valid container GUIDs, you may need to use the Optimizely CMS admin interface.'
        );
      }
    } else {
      throw new ValidationError(
        'Content creation requires a parent container. You have several options:\n\n' +
        '1. USE THE INTELLIGENT TOOL (Recommended):\n' +
        '   Tool: content_create_under\n' +
        '   Example: { "parentName": "Home", "contentType": "ArticlePage", "name": "my-article" }\n\n' +
        '2. FIND THE PARENT FIRST:\n' +
        '   Step 1: Use content_find_by_name with { "name": "Home" }\n' +
        '   Step 2: Use the returned GUID as container\n\n' +
        '3. PROVIDE A CONTAINER GUID:\n' +
        '   - "container": "<GUID>" (e.g., "12345678-1234-1234-1234-123456789012")\n' +
        '   - "parentId": "<GUID>"\n\n' +
        'TIP: Use content_site_info for detailed guidance on content creation.'
      );
    }
    
    const result = await client.post<ContentItem>('/content', request);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          content: result,
          message: `Content "${result.name}" created successfully with ID ${result.contentLink.id}`
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeContentGet(
  config: CMAConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const { contentId, language, version } = params;
    
    if (!contentId) {
      throw new ValidationError('Content ID is required');
    }
    
    const client = new OptimizelyContentClient(config);
    
    let path = `/content/${contentId}`;
    const queryParams: Record<string, string> = {};
    
    if (language) queryParams.language = language;
    if (version) queryParams.version = version;
    
    const result = await client.get<ContentItem>(path, queryParams);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeContentUpdate(
  config: CMAConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const validatedParams = validateInput(UpdateContentSchema, params);
    const client = new OptimizelyContentClient(config);
    
    // Get existing content first to preserve properties
    const existing = await client.get<ContentItem>(
      client.getContentPath(validatedParams.contentId.toString(), validatedParams.language)
    );
    
    const request: UpdateContentRequest = {
      name: validatedParams.name || existing.name,
      properties: {
        ...existing.properties,
        ...sanitizeInput(validatedParams.properties)
      },
      createNewVersion: validatedParams.createVersion
    };
    
    const result = await client.put<ContentItem>(
      client.getContentPath(validatedParams.contentId.toString(), validatedParams.language),
      request
    );
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          content: result,
          message: `Content "${result.name}" updated successfully`
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeContentPatch(
  config: CMAConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const validatedParams = validateInput(PatchContentSchema, params);
    const client = new OptimizelyContentClient(config);
    
    const result = await client.patch<ContentItem>(
      client.getContentPath(validatedParams.contentId.toString(), validatedParams.language),
      validatedParams.patches
    );
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          content: result,
          message: `Content patched successfully with ${validatedParams.patches.length} operations`
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeContentDelete(
  config: CMAConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const validatedParams = validateInput(DeleteContentSchema, params);
    const client = new OptimizelyContentClient(config);
    
    let path = `/content/${validatedParams.contentId}`;
    const queryParams: Record<string, string> = {};
    
    if (validatedParams.permanent) queryParams.permanent = 'true';
    if (validatedParams.includeDescendants) queryParams.includeDescendants = 'true';
    
    await client.delete(path + '?' + new URLSearchParams(queryParams).toString());
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Content ${validatedParams.contentId} deleted successfully`,
          permanent: validatedParams.permanent,
          includeDescendants: validatedParams.includeDescendants
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeContentMove(
  config: CMAConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const validatedParams = validateInput(MoveContentSchema, params);
    const client = new OptimizelyContentClient(config);
    
    const request: MoveContentRequest = {
      target: parseContentReference(validatedParams.targetId),
      createRedirect: validatedParams.createRedirect
    };
    
    const result = await client.put<ContentItem>(
      `/content/${validatedParams.contentId}/move`,
      request
    );
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          content: result,
          message: `Content moved successfully to ${validatedParams.targetId}`
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeContentCopy(
  config: CMAConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const validatedParams = validateInput(CopyContentSchema, params);
    const client = new OptimizelyContentClient(config);
    
    const request: CopyContentRequest = {
      target: parseContentReference(validatedParams.targetId),
      includeDescendants: validatedParams.includeDescendants,
      newName: validatedParams.newName
    };
    
    const result = await client.post<ContentItem>(
      `/content/${validatedParams.contentId}/copy`,
      request
    );
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          content: result,
          message: `Content copied successfully with new ID ${result.contentLink.id}`
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}