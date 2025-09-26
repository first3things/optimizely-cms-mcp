import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { OptimizelyContentClient } from '../../clients/cma-client.js';
import { Config } from '../../types/config.js';
import { handleError, ValidationError } from '../../utils/errors.js';
import { SimpleQueryBuilder } from '../../logic/graph/simple-query-builder.js';

/**
 * Helper tool that combines graph-get-content-by-path and content-get
 * to retrieve full content including composition in one step
 */
export async function executeGetFullContentByPath(
  config: Config,
  params: any
): Promise<CallToolResult> {
  try {
    const { path, locale = 'en' } = params;
    
    if (!path) {
      throw new ValidationError('Path is required. Example: {"path": "/"}');
    }
    
    // Step 1: Get content metadata from Graph to find the ID
    const graphClient = new OptimizelyGraphClient({
      endpoint: config.graph.endpoint,
      auth: {
        method: config.graph.authMethod,
        singleKey: config.graph.credentials.singleKey,
        appKey: config.graph.credentials.appKey,
        secret: config.graph.credentials.secret,
        username: config.graph.credentials.username,
        password: config.graph.credentials.password,
        token: config.graph.credentials.token
      },
      timeout: config.options.timeout,
      maxRetries: config.options.maxRetries
    });
    
    const queryBuilder = new SimpleQueryBuilder();
    const query = queryBuilder.buildGetContentByPathQuery(path, locale);
    const variables = queryBuilder.getPathVariables(path, locale);
    
    const graphResult = await graphClient.query(query, variables);
    
    if (!graphResult._Content?.items?.length) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: `No content found at path: ${path}`,
            locale
          }, null, 2)
        }]
      };
    }
    
    const contentItem = graphResult._Content.items[0];
    const contentId = contentItem._metadata.key;
    
    // Step 2: Get full content from CMA
    const cmaClient = new OptimizelyContentClient({
      baseUrl: config.cma.baseUrl,
      clientId: config.cma.clientId,
      clientSecret: config.cma.clientSecret,
      grantType: config.cma.grantType,
      tokenEndpoint: config.cma.tokenEndpoint,
      impersonateUser: config.cma.impersonateUser,
      timeout: config.options.timeout,
      maxRetries: config.options.maxRetries
    });
    
    const fullContent = await cmaClient.get(`/experimental/content/${contentId}`);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          metadata: contentItem._metadata,
          fullContent: fullContent,
          message: 'Retrieved full content including composition data'
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}