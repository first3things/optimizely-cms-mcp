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
    
    const types = await client.get<ContentType[]>('/contenttypes');
    
    // Filter out system types if requested
    const filteredTypes = params.includeSystemTypes 
      ? types 
      : types.filter(t => !t.name.startsWith('EPiServer.') && !t.name.startsWith('System.'));
    
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
            id: t.id,
            name: t.name,
            displayName: t.displayName,
            baseType: t.baseType,
            propertyCount: t.properties.length
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
    
    const type = await client.get<ContentType>(`/contenttypes/${params.typeId}`);
    
    // Enhance with additional metadata
    const enhancedType = {
      ...type,
      summary: {
        totalProperties: type.properties.length,
        requiredProperties: type.properties.filter(p => p.required).length,
        searchableProperties: type.properties.filter(p => p.searchable).length,
        propertyTypes: type.properties.reduce((acc, prop) => {
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
    
    const type = await client.get<ContentType>(`/contenttypes/${params.typeId}`);
    
    // Convert to JSON Schema format
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: type.displayName,
      description: type.description,
      type: 'object',
      properties: type.properties.reduce((acc, prop) => {
        acc[prop.name] = {
          title: prop.displayName,
          description: prop.description,
          type: mapDataTypeToJsonType(prop.dataType),
          ...(prop.required && { required: true }),
          ...(prop.settings && { metadata: prop.settings })
        };
        return acc;
      }, {} as Record<string, any>),
      required: type.properties.filter(p => p.required).map(p => p.name),
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