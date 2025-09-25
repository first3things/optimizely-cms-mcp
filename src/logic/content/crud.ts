import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OptimizelyContentClient } from '../../clients/cma-client.js';
import { CMAConfig } from '../../types/config.js';
import { 
  ContentItem,
  ContentReference
} from '../../types/optimizely.js';
import { handleError, ValidationError } from '../../utils/errors.js';
import { validateInput, sanitizeInput } from '../../utils/validation.js';
import { z } from 'zod';

// Validation schemas
// Removed unused ContentReferenceSchema

const CreateContentSchema = z.object({
  contentType: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
  name: z.string().min(1),
  displayName: z.string().min(1).optional(),
  properties: z.record(z.any()).optional(),
  parentId: z.union([z.string(), z.number(), z.null()]).optional(),
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
    
    // Check if we have null values that need smart handling
    if (validatedParams.contentType === null || !validatedParams.contentType ||
        (!validatedParams.container && !validatedParams.parentId)) {
      // This should be handled by the tool handler, but as a fallback
      throw new ValidationError(
        'Content creation requires both contentType and a parent container. ' +
        'The content-create tool handler should have redirected to smart creation. ' +
        'Please report this issue.'
      );
    }
    
    const client = new OptimizelyContentClient(config);
    
    // Prepare the request according to CMA API specification
    // The API expects a ContentItem structure
    const request: any = {
      displayName: validatedParams.displayName || validatedParams.name,
      properties: {}
    };
    
    // According to the spec, contentType is required for creation
    if (validatedParams.contentType) {
      const contentType = Array.isArray(validatedParams.contentType) 
        ? validatedParams.contentType[0] 
        : validatedParams.contentType;
      request.contentType = contentType;
    }

    // Handle properties - merge with any provided properties
    if (validatedParams.properties) {
      request.properties = sanitizeInput(validatedParams.properties);
    }
    
    // Set other required fields from the API spec
    request.status = 'draft'; // New content starts as draft
    
    // Handle parent container - API requires 'container' field
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
    
    // Handle language/locale
    if (validatedParams.language) {
      request.locale = validatedParams.language;
    }
    
    // Use the experimental content endpoint
    const result = await client.post<ContentItem>('/experimental/content', request);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          content: result,
          message: `Content created successfully`
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
    
    // Use experimental endpoint for content operations
    let path = `/experimental/content/${contentId}`;
    if (version) {
      path += `/versions/${version}`;
    }
    
    const queryParams: Record<string, string> = {};
    if (language) queryParams.locale = language;
    
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
      client.getContentPath(validatedParams.contentId.toString())
    );
    
    // API uses PATCH with merge-patch+json for updates
    const patchData: any = {};
    
    if (validatedParams.name) {
      patchData.displayName = validatedParams.name;
    }
    
    if (validatedParams.properties) {
      patchData.properties = {
        ...existing.properties,
        ...sanitizeInput(validatedParams.properties)
      };
    }
    
    // Use the patch method with proper content type
    const result = await client.request<ContentItem>(
      client.getContentPath(validatedParams.contentId.toString()),
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/merge-patch+json'
        },
        body: JSON.stringify(patchData)
      }
    );
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          content: result.data,
          message: `Content updated successfully`
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
      client.getContentPath(validatedParams.contentId.toString()),
      validatedParams.patches,
      false // Use JSON Patch format
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
    
    // Use experimental endpoint
    let path = `/experimental/content/${validatedParams.contentId}`;
    const headers: Record<string, string> = {};
    
    // The API uses headers for permanent delete option
    if (validatedParams.permanent) {
      headers['cms-permanent-delete'] = 'true';
    }
    
    await client.request(path, {
      method: 'DELETE',
      headers
    });
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Content ${validatedParams.contentId} deleted successfully`,
          permanent: validatedParams.permanent
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
    
    // According to API spec, move is done via PATCH on metadata
    const patchData = {
      container: validatedParams.targetId.toString()
    };
    
    const result = await client.request<any>(
      `/experimental/content/${validatedParams.contentId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/merge-patch+json'
        },
        body: JSON.stringify(patchData)
      }
    );
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          content: result.data,
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
    
    // According to API spec, copy endpoint expects CopyContentOptions
    const request: any = {
      container: validatedParams.targetId.toString()
    };
    
    if (validatedParams.includeDescendants) {
      request.keepPublishedStatus = true; // Preserve published status during copy
    }
    
    const result = await client.post<any>(
      `/experimental/content/${validatedParams.contentId}:copy`,
      request
    );
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          content: result,
          message: `Content copied successfully`
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}