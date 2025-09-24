import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OptimizelyContentClient } from '../../clients/cma-client.js';
import { CMAConfig } from '../../types/config.js';
import { handleError } from '../../utils/errors.js';

export async function executeGetSiteInfo(
  config: CMAConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const client = new OptimizelyContentClient(config);
    
    // Provide guidance on finding container GUIDs
    const guidance = {
      message: "Container GUID Required for Content Creation",
      explanation: "The Optimizely Content Management API requires a valid container GUID when creating content.",
      instructions: [
        "1. Log in to your Optimizely CMS admin interface",
        "2. Navigate to the content tree where you want to create content",
        "3. Right-click on a folder/page and select 'Properties' or 'Settings'",
        "4. Look for the content GUID in the properties panel",
        "5. Use this GUID as the 'container' parameter when creating content"
      ],
      example: {
        contentCreation: {
          tool: "content-create",
          parameters: {
            contentType: "StandardPage",
            name: "My New Page",
            displayName: "My New Page",
            container: "12345678-1234-1234-1234-123456789012",
            language: "en",
            properties: {
              MainBody: "<p>Page content here</p>",
              Title: "My Page Title"
            }
          }
        }
      },
      alternativeApproaches: [
        "Use the GraphQL API (graph_search, graph_get_by_id) to find existing content and note their GUIDs",
        "Contact your Optimizely administrator for the root container GUID",
        "Check your Optimizely documentation for site-specific container GUIDs"
      ],
      apiLimitations: [
        "The preview3/experimental API does not support listing content via GET requests",
        "Container discovery endpoints are not available in the current API version",
        "Content creation requires explicit parent container specification"
      ]
    };
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(guidance, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeTestContentApi(
  config: CMAConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const client = new OptimizelyContentClient(config);
    
    const results = {
      authentication: false,
      endpoints: {} as Record<string, any>
    };
    
    // Test authentication by making a simple request
    try {
      // The API is very limited, but we can test if auth works
      const response = await client.request('/content/00000000-0000-0000-0000-000000000000');
      results.authentication = true;
    } catch (error: any) {
      // 404 is expected for invalid GUID, but it means auth worked
      if (error.status === 404) {
        results.authentication = true;
      }
    }
    
    // Test known endpoints
    const testEndpoints = [
      { path: '/content', method: 'POST', description: 'Content creation endpoint' },
      { path: '/contenttypes', method: 'GET', description: 'List content types' },
      { path: '/languages', method: 'GET', description: 'List languages' }
    ];
    
    for (const endpoint of testEndpoints) {
      try {
        const response = await client.request(endpoint.path, { method: endpoint.method });
        results.endpoints[endpoint.path] = {
          status: 'available',
          method: endpoint.method,
          description: endpoint.description
        };
      } catch (error: any) {
        results.endpoints[endpoint.path] = {
          status: 'error',
          method: endpoint.method,
          description: endpoint.description,
          error: error.status || error.message
        };
      }
    }
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          apiStatus: results,
          recommendation: "Use 'content-site-info' tool for guidance on finding container GUIDs",
          note: "The Content Management API requires valid container GUIDs for content creation"
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}