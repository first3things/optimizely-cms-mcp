/**
 * Fragment Generator Service
 *
 * Dynamically generates GraphQL fragments for Visual Builder components
 * by introspecting the schema and discovering component types that implement _IComponent.
 *
 * This enables the GET tool to retrieve complete Visual Builder pages with all
 * component fields in a single query, eliminating the need for multiple API calls.
 */

import { SchemaIntrospector, FieldInfo } from '../logic/graph/schema-introspector.js';
import { GeneratedFragment } from '../types/fragments.js';
import { getLogger } from '../utils/logger.js';

export class FragmentGenerator {
  private logger = getLogger();

  constructor(private introspector: SchemaIntrospector) {}

  /**
   * Generate the AllComponents fragment containing all component types
   * This is the main entry point for fragment generation
   */
  async generateAllComponentsFragment(): Promise<GeneratedFragment> {
    this.logger.debug('Generating AllComponents fragment');

    // Discover all component types
    const componentTypes = await this.discoverComponentTypes();
    this.logger.info(`Discovered ${componentTypes.length} component types`, { types: componentTypes });

    // Generate fragments for each component
    const fragmentParts: string[] = [];

    for (const typeName of componentTypes) {
      const componentFragment = await this.generateComponentFragment(typeName);
      if (componentFragment) {
        fragmentParts.push(componentFragment);
      }
    }

    if (fragmentParts.length === 0) {
      this.logger.warn('No component fragments generated');
    }

    // Combine into AllComponents fragment
    // CRITICAL: Use _IComponent not IContent - components implement _IComponent interface
    const fragmentContent = [
      'fragment AllComponents on _IComponent {',
      '  _metadata {',
      '    key',
      '    displayName',
      '    types',
      '  }',
      '  _type: __typename',
      ...fragmentParts.map(f => '  ' + f.split('\n').join('\n  ')), // Indent each fragment
      '}'
    ].join('\n');

    return {
      name: 'AllComponents',
      content: fragmentContent,
      componentTypes,
      generatedAt: new Date()
    };
  }

  /**
   * Discover all component types implementing _IComponent interface
   * Falls back to common component patterns if interface discovery fails
   */
  async discoverComponentTypes(): Promise<string[]> {
    this.logger.debug('Discovering component types via _IComponent interface');

    try {
      // Use introspector to get types implementing _IComponent
      const componentTypes = await this.introspector.getTypesImplementing('_IComponent');

      // Filter out system types
      const filtered = componentTypes.filter(name =>
        !name.startsWith('_') &&
        !name.startsWith('__') &&
        name !== 'IContent' &&
        name !== 'IComponent'
      );

      if (filtered.length > 0) {
        this.logger.info(`Found ${filtered.length} component types via _IComponent`, { types: filtered });
        return filtered;
      }

      // If no types found, fall back
      this.logger.warn('No types found implementing _IComponent, falling back to common types');
      return this.discoverCommonComponentTypes();

    } catch (error) {
      this.logger.warn('Failed to discover via _IComponent, falling back to common types', { error });
      return this.discoverCommonComponentTypes();
    }
  }

  /**
   * Fallback: Discover common component types by checking if they exist
   * This ensures we can still generate fragments even if interface discovery fails
   */
  private async discoverCommonComponentTypes(): Promise<string[]> {
    const commonPatterns = [
      'Hero', 'Paragraph', 'Text', 'Divider', 'Card',
      'Image', 'Video', 'Button', 'Link', 'List',
      'Accordion', 'Carousel', 'Gallery', 'Form',
      'Quote', 'Callout', 'Banner', 'Spacer'
    ];

    const componentTypes: string[] = [];

    for (const pattern of commonPatterns) {
      try {
        const typeInfo = await this.introspector.getContentType(pattern);
        if (typeInfo && typeInfo.fields && typeInfo.fields.length > 0) {
          componentTypes.push(pattern);
          this.logger.debug(`Found common component type: ${pattern}`);
        }
      } catch {
        // Type doesn't exist, skip it
      }
    }

    this.logger.info(`Discovered ${componentTypes.length} common component types`, { types: componentTypes });
    return componentTypes;
  }

  /**
   * Generate fragment for a specific component type
   * Creates an inline fragment with all queryable fields
   */
  async generateComponentFragment(typeName: string): Promise<string | null> {
    this.logger.debug(`Generating fragment for component: ${typeName}`);

    try {
      // Get type information
      const typeInfo = await this.introspector.getContentType(typeName);
      if (!typeInfo) {
        this.logger.warn(`No type info found for: ${typeName}`);
        return null;
      }

      // Generate field projections
      const fieldProjections: string[] = [];

      for (const field of typeInfo.fields) {
        // Skip system fields (already in base fragment)
        if (field.name.startsWith('_')) continue;

        const projection = this.getFieldProjection(field);
        if (projection) {
          fieldProjections.push(projection);
        }
      }

      if (fieldProjections.length === 0) {
        this.logger.warn(`No queryable fields found for component: ${typeName}`);
        return null;
      }

      // Build inline fragment
      const fragment = [
        `... on ${typeName} {`,
        ...fieldProjections.map(f => '  ' + f),
        '}'
      ].join('\n');

      this.logger.debug(`Generated fragment for ${typeName} with ${fieldProjections.length} fields`);
      return fragment;

    } catch (error) {
      this.logger.error(`Failed to generate fragment for ${typeName}`, { error });
      return null;
    }
  }

  /**
   * Get projection string for a field based on its type
   * Handles complex types like RichText, ContentReference, etc.
   */
  private getFieldProjection(field: FieldInfo): string | null {
    const fieldType = field.type.toLowerCase();

    // RichText fields - get both html and json
    if (fieldType.includes('richtext')) {
      return `${field.name} { html json }`;
    }

    // ContentReference fields - use url object (VERIFIED working)
    if (fieldType.includes('contentreference')) {
      return `${field.name} { url { default } }`;
    }

    // ContentArea fields (array of content) - use url object
    if (fieldType.includes('contentarea')) {
      return `${field.name} { url { default } }`;
    }

    // Link/URL fields - check Link type specifically
    if (fieldType.includes('link') && !fieldType.includes('contentreference')) {
      return `${field.name} { url { default } text }`;
    }

    // Image/Media fields - use url object
    if (fieldType.includes('image') || fieldType.includes('media')) {
      return `${field.name} { url { default } }`;
    }

    // Scalar fields (String, Int, Boolean, Date, etc.)
    if (this.isScalarType(fieldType)) {
      return field.name;
    }

    // Complex object types - skip for now (would require recursive introspection)
    this.logger.debug(`Skipping complex field type: ${field.name} (${field.type})`);
    return null;
  }

  /**
   * Check if a type is a scalar type
   */
  private isScalarType(fieldType: string): boolean {
    const scalarTypes = [
      'string', 'int', 'integer', 'float', 'double',
      'boolean', 'bool', 'date', 'datetime', 'id',
      'decimal', 'long'
    ];

    return scalarTypes.some(scalar => fieldType.includes(scalar));
  }

  /**
   * Generate individual component fragments (for caching separately)
   * Returns a map of component type name to fragment content
   */
  async generateComponentFragments(): Promise<Map<string, string>> {
    const componentTypes = await this.discoverComponentTypes();
    const fragments = new Map<string, string>();

    for (const typeName of componentTypes) {
      const fragment = await this.generateComponentFragment(typeName);
      if (fragment) {
        fragments.set(typeName, fragment);
      }
    }

    this.logger.info(`Generated ${fragments.size} individual component fragments`);
    return fragments;
  }
}
