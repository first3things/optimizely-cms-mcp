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
    
    let languages: LanguageInfo[];
    
    if (validatedParams.contentId) {
      // Get languages for specific content
      const path = client.getLanguagePath(validatedParams.contentId.toString());
      languages = await client.get<LanguageInfo[]>(path);
    } else {
      // Get all available languages in the system
      languages = await client.get<LanguageInfo[]>('/languages');
    }
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          contentId: validatedParams.contentId,
          languages: languages,
          totalLanguages: languages.length,
          masterLanguage: languages.find(l => l.isMasterLanguage)?.name
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
      sourceContent = await client.get<ContentItem>(
        client.getContentPath(validatedParams.contentId.toString(), validatedParams.sourceLanguage)
      );
    } else {
      // Get content from master language
      const languages = await client.get<LanguageInfo[]>(
        client.getLanguagePath(validatedParams.contentId.toString())
      );
      const masterLanguage = languages.find(l => l.isMasterLanguage);
      
      if (!masterLanguage) {
        throw new ValidationError('No master language found for content');
      }
      
      sourceContent = await client.get<ContentItem>(
        client.getContentPath(validatedParams.contentId.toString(), masterLanguage.name)
      );
    }
    
    // Create language branch by copying content to new language
    const request = {
      name: sourceContent.name,
      properties: sourceContent.properties,
      language: validatedParams.language
    };
    
    const result = await client.post<ContentItem>(
      `/content/${validatedParams.contentId}/languages/${validatedParams.language}`,
      request
    );
    
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