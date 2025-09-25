import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OptimizelyContentClient } from '../../clients/cma-client.js';
import { CMAConfig } from '../../types/config.js';
import { VersionInfo, LanguageInfo, ContentItem } from '../../types/optimizely.js';
import { handleError, ValidationError } from '../../utils/errors.js';
import { validateInput } from '../../utils/validation.js';
import { z } from 'zod';

// Validation schemas
const ListVersionsSchema = z.object({
  contentId: z.union([z.string(), z.number()]),
  language: z.string().optional()
});

const CreateVersionSchema = z.object({
  contentId: z.union([z.string(), z.number()]),
  language: z.string(),
  basedOn: z.string().optional()
});

const PromoteVersionSchema = z.object({
  contentId: z.union([z.string(), z.number()]),
  version: z.string(),
  language: z.string()
});

const ListLanguagesSchema = z.object({
  contentId: z.union([z.string(), z.number()]).optional()
});

const CreateLanguageBranchSchema = z.object({
  contentId: z.union([z.string(), z.number()]),
  language: z.string(),
  sourceLanguage: z.string().optional()
});

export async function executeContentListVersions(
  config: CMAConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const validatedParams = validateInput(ListVersionsSchema, params);
    const client = new OptimizelyContentClient(config);
    
    const path = client.getVersionPath(
      validatedParams.contentId.toString(),
      undefined,
      validatedParams.language
    );
    
    const versions = await client.get<VersionInfo[]>(path);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          contentId: validatedParams.contentId,
          language: validatedParams.language,
          versions: versions,
          totalVersions: versions.length
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeContentCreateVersion(
  config: CMAConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const validatedParams = validateInput(CreateVersionSchema, params);
    const client = new OptimizelyContentClient(config);
    
    // First, get the content in the specified language
    const content = await client.get<ContentItem>(
      client.getContentPath(validatedParams.contentId.toString(), validatedParams.language)
    );
    
    // Create a new version by updating with createNewVersion flag
    const request = {
      name: content.name,
      properties: content.properties,
      createNewVersion: true
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
          message: `New version created for content ${validatedParams.contentId} in language ${validatedParams.language}`,
          content: result
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeContentPromoteVersion(
  config: CMAConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const validatedParams = validateInput(PromoteVersionSchema, params);
    const client = new OptimizelyContentClient(config);
    
    // Promote version by making it the primary version
    const result = await client.post<ContentItem>(
      `/content/${validatedParams.contentId}/versions/${validatedParams.version}/promote`,
      { language: validatedParams.language }
    );
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Version ${validatedParams.version} promoted to primary for language ${validatedParams.language}`,
          content: result
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeContentListLanguages(
  config: CMAConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const validatedParams = validateInput(ListLanguagesSchema, params);
    const client = new OptimizelyContentClient(config);
    
    // FIX 6: /languages endpoint doesn't exist
    // To see locales, fetch GET /experimental/content/{key} and inspect locales
    
    if (!validatedParams.contentId) {
      throw new ValidationError(
        'The /languages endpoint does not exist in the API.\n' +
        'To see available locales for content:\n' +
        '1. Provide a contentId to get locales for that specific content\n' +
        '2. Use: GET /experimental/content/{key} and inspect the "locales" field'
      );
    }
    
    // Get content metadata to see available locales
    const metadata = await client.get<any>(
      `/experimental/content/${validatedParams.contentId}`
    );
    
    // Extract locale information from metadata
    const locales = metadata.locales || {};
    const localeInfo = Object.entries(locales).map(([locale, info]: [string, any]) => ({
      name: locale,
      displayName: info.displayName || locale,
      status: info.status,
      created: info.created,
      createdBy: info.createdBy
    }));
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          contentId: validatedParams.contentId,
          locales: localeInfo,
          totalLocales: localeInfo.length,
          metadata: metadata
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeContentCreateLanguageBranch(
  config: CMAConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const validatedParams = validateInput(CreateLanguageBranchSchema, params);
    const client = new OptimizelyContentClient(config);
    
    let sourceContent: ContentItem | null = null;
    
    // If source language is specified, get content from that language
    if (validatedParams.sourceLanguage) {
      // Use versions endpoint with locale query param
      sourceContent = await client.get<ContentItem>(
        `/experimental/content/${validatedParams.contentId}/versions?locale=${validatedParams.sourceLanguage}`
      );
    } else {
      // Get content metadata to find available locales
      const metadata = await client.get<any>(
        `/experimental/content/${validatedParams.contentId}`
      );
      
      // Try to find a source locale (first available)
      const locales = Object.keys(metadata.locales || {});
      if (locales.length === 0) {
        throw new ValidationError('No locales found for content');
      }
      
      // Use the first available locale as source
      sourceContent = await client.get<ContentItem>(
        `/experimental/content/${validatedParams.contentId}/versions?locale=${locales[0]}`
      );
    }
    
    // Create language branch by creating a new version with target locale
    const request = {
      displayName: sourceContent.displayName || sourceContent.name,
      properties: sourceContent.properties,
      status: 'draft',
      contentType: sourceContent.contentType
    };
    
    // Create version with target locale as query parameter
    const endpoint = `/experimental/content/${validatedParams.contentId}/versions?locale=${validatedParams.language}`;
    
    const result = await client.post<ContentItem>(endpoint, request);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Language branch ${validatedParams.language} created for content ${validatedParams.contentId}`,
          sourceLanguage: validatedParams.sourceLanguage || 'master',
          content: result
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}