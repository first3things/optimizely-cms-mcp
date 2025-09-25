/**
 * Content Type Analyzer Tool
 * Provides detailed analysis of content type requirements and fields
 */

import { ToolDefinition } from '../types/tools.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Config } from '../config.js';
import { AdapterRegistry } from '../adapters/registry.js';
import { getLogger } from '../utils/logger.js';
import { z } from 'zod';

const AnalyzeTypeSchema = z.object({
  contentType: z.string().min(1).describe('The content type to analyze'),
  includeExamples: z.boolean().optional().default(true).describe('Include example values for fields'),
  includeInherited: z.boolean().optional().default(true).describe('Include inherited properties from base types')
});

export const contentTypeAnalyzerTool: ToolDefinition = {
  name: 'content_type_analyzer',
  description: 'Analyze a content type to understand its requirements, fields, and smart defaults',
  inputSchema: AnalyzeTypeSchema.shape,
  handler: async (params: any, context: any): Promise<CallToolResult> => {
    const config = context as Config;
    const logger = getLogger();
    const validated = AnalyzeTypeSchema.parse(params);
    
    try {
      // Get adapter
      const registry = AdapterRegistry.getInstance();
      const adapter = registry.getOptimizelyAdapter(config.cma);
      
      logger.debug(`Analyzing content type: ${validated.contentType}`);
      
      // Get schema
      const schema = await adapter.getContentTypeSchema(validated.contentType);
      
      // Get field defaults
      const defaults = await adapter.getFieldDefaults(validated.contentType);
      
      // Build analysis report
      const analysis = {
        contentType: schema.name,
        displayName: schema.displayName,
        baseType: schema.baseType,
        totalProperties: schema.properties.length,
        requiredFields: schema.required.length,
        
        // Required fields analysis
        requiredFieldsDetails: schema.required.map(fieldPath => {
          const prop = schema.properties.find(p => p.path === fieldPath);
          const defaultValue = schema.defaults[fieldPath];
          const fieldDefault = defaults.find(d => d.field === fieldPath);
          
          return {
            path: fieldPath,
            type: prop?.type || 'unknown',
            description: prop?.description,
            hasDefault: defaultValue !== undefined,
            defaultValue: defaultValue,
            defaultSource: fieldDefault ? 'smart' : defaultValue !== undefined ? 'schema' : 'none',
            allowedValues: prop?.allowedValues
          };
        }),
        
        // All fields with categorization
        fieldsByCategory: {
          seo: schema.properties.filter(p => p.path.toLowerCase().includes('seo')),
          metadata: schema.properties.filter(p => 
            p.path.toLowerCase().includes('meta') || 
            p.path.toLowerCase().includes('created') ||
            p.path.toLowerCase().includes('modified')
          ),
          content: schema.properties.filter(p => 
            !p.path.toLowerCase().includes('seo') && 
            !p.path.toLowerCase().includes('meta') &&
            !p.path.toLowerCase().includes('created') &&
            !p.path.toLowerCase().includes('modified')
          )
        },
        
        // Smart defaults
        smartDefaults: defaults.map(d => ({
          field: d.field,
          value: d.value,
          conditional: !!d.condition,
          description: `Smart default for ${d.field}`
        })),
        
        // Validation rules
        validationRules: schema.properties
          .filter(p => p.validation)
          .map(p => ({
            field: p.path,
            rule: p.validation
          }))
      };
      
      // Add examples if requested
      if (validated.includeExamples) {
        (analysis as any).examplePayload = await generateExamplePayload(
          schema, 
          adapter, 
          validated.contentType
        );
      }
      
      // Format output
      const output = formatAnalysisReport(analysis);
      
      return {
        content: [{
          type: 'text',
          text: output
        }]
      };
      
    } catch (error) {
      logger.error('Content type analysis failed:', error);
      return {
        isError: true,
        content: [{
          type: 'text',
          text: `Failed to analyze content type: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }
};

async function generateExamplePayload(
  schema: any,
  adapter: any,
  contentType: string
): Promise<any> {
  const example: any = {
    displayName: "Example " + schema.displayName,
    contentType: contentType,
    properties: {}
  };
  
  // Add required fields with examples
  for (const required of schema.required) {
    const prop = schema.properties.find((p: any) => p.path === required);
    if (!prop) continue;
    
    // Get suggested values
    const suggestions = await adapter.getSuggestedValues(required, contentType);
    
    // Set example value
    const value = schema.defaults[required] || 
                 suggestions[0] || 
                 getExampleForType(prop.type);
    
    setNestedValue(example.properties, required, value);
  }
  
  return example;
}

function getExampleForType(type: string): any {
  switch (type) {
    case 'string': return 'Example text';
    case 'number': return 123;
    case 'boolean': return true;
    case 'date': return new Date().toISOString();
    case 'url': return 'https://example.com';
    case 'html': return '<p>Example HTML content</p>';
    case 'array': return [];
    case 'object': return {};
    default: return null;
  }
}

function setNestedValue(obj: any, path: string, value: any): void {
  const keys = path.split('.');
  const lastKey = keys.pop()!;
  const target = keys.reduce((curr, key) => {
    if (!curr[key]) curr[key] = {};
    return curr[key];
  }, obj);
  target[lastKey] = value;
}

function formatAnalysisReport(analysis: any): string {
  const lines = [
    `# Content Type Analysis: ${analysis.displayName}`,
    ``,
    `## Overview`,
    `- **Type Key**: ${analysis.contentType}`,
    `- **Base Type**: ${analysis.baseType}`,
    `- **Total Properties**: ${analysis.totalProperties}`,
    `- **Required Fields**: ${analysis.requiredFields}`,
    ``,
    `## Required Fields`,
    ``
  ];
  
  for (const field of (analysis as any).requiredFieldsDetails || []) {
    lines.push(`### ${field.path}`);
    lines.push(`- **Type**: ${field.type}`);
    if (field.description) {
      lines.push(`- **Description**: ${field.description}`);
    }
    lines.push(`- **Has Default**: ${field.hasDefault ? 'Yes' : 'No'}`);
    if (field.hasDefault) {
      lines.push(`- **Default Value**: ${JSON.stringify(field.defaultValue)}`);
      lines.push(`- **Default Source**: ${field.defaultSource}`);
    }
    if (field.allowedValues) {
      lines.push(`- **Allowed Values**: ${field.allowedValues.join(', ')}`);
    }
    lines.push(``);
  }
  
  lines.push(`## Field Categories`);
  lines.push(``);
  
  if (analysis.fieldsByCategory.seo.length > 0) {
    lines.push(`### SEO Fields (${analysis.fieldsByCategory.seo.length})`);
    for (const field of analysis.fieldsByCategory.seo) {
      lines.push(`- ${field.path} (${field.type})`);
    }
    lines.push(``);
  }
  
  if (analysis.fieldsByCategory.metadata.length > 0) {
    lines.push(`### Metadata Fields (${analysis.fieldsByCategory.metadata.length})`);
    for (const field of analysis.fieldsByCategory.metadata) {
      lines.push(`- ${field.path} (${field.type})`);
    }
    lines.push(``);
  }
  
  if (analysis.fieldsByCategory.content.length > 0) {
    lines.push(`### Content Fields (${analysis.fieldsByCategory.content.length})`);
    for (const field of analysis.fieldsByCategory.content) {
      lines.push(`- ${field.path} (${field.type})`);
    }
    lines.push(``);
  }
  
  if (analysis.smartDefaults.length > 0) {
    lines.push(`## Smart Defaults`);
    lines.push(``);
    for (const def of analysis.smartDefaults) {
      lines.push(`- **${def.field}**: ${JSON.stringify(def.value)}${def.conditional ? ' (conditional)' : ''}`);
    }
    lines.push(``);
  }
  
  if (analysis.validationRules.length > 0) {
    lines.push(`## Validation Rules`);
    lines.push(``);
    for (const rule of analysis.validationRules) {
      lines.push(`- **${rule.field}**: ${JSON.stringify(rule.rule)}`);
    }
    lines.push(``);
  }
  
  if (analysis.examplePayload) {
    lines.push(`## Example Payload`);
    lines.push(``);
    lines.push('```json');
    lines.push(JSON.stringify(analysis.examplePayload, null, 2));
    lines.push('```');
  }
  
  return lines.join('\n');
}