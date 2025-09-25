import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OptimizelyContentClient } from '../../clients/cma-client.js';
import { CMAConfig } from '../../types/config.js';
import { ContentType } from '../../types/optimizely.js';
import { handleError, ValidationError } from '../../utils/errors.js';

export async function executeTypeList(
  config: CMAConfig,
  params: { includeSystemTypes?: boolean }
): Promise<CallToolResult> {
  try {
    const client = new OptimizelyContentClient(config);
    
    // The preview3 API returns paginated results with an 'items' array
    const response = await client.get('/contentTypes');
    const types = response.items || [];
    
    // Filter out system types if requested
    const filteredTypes = params.includeSystemTypes 
      ? types 
      : types.filter(t => !t.key.startsWith('EPiServer.') && !t.key.startsWith('System.'));
    
    // Group types by base type
    const groupedTypes = filteredTypes.reduce((acc, type) => {
      const baseType = type.baseType || 'Unknown';
      if (!acc[baseType]) acc[baseType] = [];
      acc[baseType].push(type);
      return acc;
    }, {} as Record<string, ContentType[]>);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          totalTypes: filteredTypes.length,
          typesByBase: groupedTypes,
          types: filteredTypes.map(t => ({
            key: t.key,
            name: t.key, // For backwards compatibility
            displayName: t.displayName,
            baseType: t.baseType,
            description: t.description,
            source: t.source,
            propertyCount: Object.keys(t.properties || {}).length
          }))
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeTypeGet(
  config: CMAConfig,
  params: { typeId: string }
): Promise<CallToolResult> {
  try {
    if (!params.typeId) {
      throw new ValidationError('Type ID is required');
    }
    
    const client = new OptimizelyContentClient(config);
    
    const type = await client.get<ContentType>(`/contentTypes/${params.typeId}`);
    
    // Enhance with additional metadata
    const properties = Object.values(type.properties || {});
    const enhancedType = {
      ...type,
      summary: {
        totalProperties: properties.length,
        requiredProperties: properties.filter(p => p.required).length,
        searchableProperties: properties.filter(p => p.searchable).length,
        propertyTypes: properties.reduce((acc, prop) => {
          acc[prop.dataType] = (acc[prop.dataType] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      }
    };
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(enhancedType, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeTypeGetSchema(
  config: CMAConfig,
  params: { typeId: string }
): Promise<CallToolResult> {
  try {
    if (!params.typeId) {
      throw new ValidationError('Type ID is required');
    }
    
    const client = new OptimizelyContentClient(config);
    
    const type = await client.get<ContentType>(`/contentTypes/${params.typeId}`);
    
    // Convert to JSON Schema format
    const properties = Object.values(type.properties || {});
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: type.displayName,
      description: type.description,
      type: 'object',
      properties: properties.reduce((acc, prop) => {
        acc[prop.name] = {
          title: prop.displayName,
          description: prop.description,
          type: mapDataTypeToJsonType(prop.dataType),
          ...(prop.required && { required: true }),
          ...(prop.settings && { metadata: prop.settings })
        };
        return acc;
      }, {} as Record<string, any>),
      required: properties.filter(p => p.required).map(p => p.name),
      additionalProperties: false
    };
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(schema, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

// Helper function to map Optimizely data types to JSON Schema types
function mapDataTypeToJsonType(dataType: string): string {
  const typeMap: Record<string, string> = {
    'String': 'string',
    'LongString': 'string',
    'XhtmlString': 'string',
    'Int32': 'integer',
    'Int64': 'integer',
    'Double': 'number',
    'Decimal': 'number',
    'Boolean': 'boolean',
    'DateTime': 'string',
    'Url': 'string',
    'ContentReference': 'object',
    'PageReference': 'object',
    'LinkCollection': 'array',
    'ContentArea': 'array'
  };
  
  return typeMap[dataType] || 'string';
}