import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OptimizelyContentClient } from '../../clients/cma-client.js';
import { CMAConfig } from '../../types/config.js';
import { handleError } from '../../utils/errors.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();

// Dynamic pattern matching - no hardcoded content types
// These are generic patterns used for similarity scoring only
const GENERIC_TYPE_PATTERNS = {
  'article': ['article', 'post', 'news'],
  'page': ['page', 'content'],
  'product': ['product', 'item', 'catalog'],
  'blog': ['blog', 'post', 'article'],
  'news': ['news', 'press', 'announcement'],
  'landing': ['landing', 'campaign', 'marketing'],
  'home': ['home', 'start', 'front', 'index']
};

export async function executeContentTypeDiscovery(
  config: CMAConfig,
  params: { suggestedType?: string; includeDescriptions?: boolean }
): Promise<CallToolResult> {
  try {
    const client = new OptimizelyContentClient(config);
    
    logger.info('Discovering content types', { suggestedType: params.suggestedType });
    
    // Get all content types - dynamically discover what's available
    const response = await client.get('/contentTypes');
    const contentTypes = response.items || [];
    
    // If a suggested type is provided, use pattern matching
    if (params.suggestedType) {
      const suggested = params.suggestedType.toLowerCase();
      const matches = [];
      
      // Score content types based on similarity
      for (const ct of contentTypes) {
        let score = 0;
        const ctKey = ct.key?.toLowerCase() || '';
        const ctDisplay = ct.displayName?.toLowerCase() || '';
        
        // Direct matches
        if (ctKey === suggested) score += 100;
        if (ctDisplay === suggested) score += 90;
        
        // Contains matches
        if (ctKey.includes(suggested)) score += 50;
        if (ctDisplay.includes(suggested)) score += 40;
        
        // Pattern-based scoring (generic, not hardcoded types)
        for (const [pattern, keywords] of Object.entries(GENERIC_TYPE_PATTERNS)) {
          if (suggested.includes(pattern)) {
            for (const keyword of keywords) {
              if (ctKey.includes(keyword)) score += 20;
            }
          }
        }
        
        if (score > 0) {
          matches.push({ contentType: ct, score });
        }
      }
      
      // Sort by score
      matches.sort((a, b) => b.score - a.score);
      
      if (matches.length > 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              suggestedType: params.suggestedType,
              matches: matches.slice(0, 5).map(m => ({
                name: m.contentType.key,
                displayName: m.contentType.displayName,
                description: m.contentType.description,
                baseType: m.contentType.baseType,
                confidence: Math.min(m.score, 100) + '%'
              })),
              recommendation: matches[0].contentType.key,
              message: `Found ${matches.length} content type(s) matching "${params.suggestedType}". Recommended: ${matches[0].contentType.key}`
            }, null, 2)
          }]
        };
      }
    }
    
    // Categorize dynamically based on baseType and naming patterns
    const pageTypes = contentTypes.filter(ct => 
      ct.baseType === '_page' || 
      ct.key?.toLowerCase().includes('page') ||
      ct.displayName?.toLowerCase().includes('page')
    );
    
    const blockTypes = contentTypes.filter(ct => 
      ct.baseType === '_component' || 
      ct.key?.toLowerCase().includes('block') ||
      ct.key?.toLowerCase().includes('component') ||
      ct.displayName?.toLowerCase().includes('block')
    );
    
    const otherTypes = contentTypes.filter(ct => 
      !pageTypes.includes(ct) && !blockTypes.includes(ct)
    );
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          summary: {
            total: contentTypes.length,
            pages: pageTypes.length,
            blocks: blockTypes.length,
            other: otherTypes.length
          },
          pageTypes: pageTypes.map(ct => ({
            name: ct.key,
            displayName: ct.displayName,
            description: params.includeDescriptions ? ct.description : undefined
          })),
          blockTypes: blockTypes.map(ct => ({
            name: ct.key,
            displayName: ct.displayName,
            description: params.includeDescriptions ? ct.description : undefined
          })),
          otherTypes: otherTypes.map(ct => ({
            name: ct.key,
            displayName: ct.displayName,
            description: params.includeDescriptions ? ct.description : undefined
          })),
          message: params.suggestedType 
            ? `No exact match found for "${params.suggestedType}". Showing all available types.`
            : 'Discovered content types in your CMS, categorized by type.'
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeSmartContentTypeMatch(
  config: CMAConfig,
  params: { requestedType: string; context?: string }
): Promise<CallToolResult> {
  try {
    const client = new OptimizelyContentClient(config);
    
    logger.info('Smart matching content type', { 
      requestedType: params.requestedType,
      context: params.context 
    });
    
    // Normalize the requested type
    const normalized = params.requestedType
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z]/g, '');
    
    // Get all content types - dynamically discover
    const response = await client.get('/contentTypes');
    const contentTypes = response.items || [];
    
    // Score each content type
    const scores = contentTypes.map(ct => {
      let score = 0;
      const ctName = ct.key?.toLowerCase() || '';
      const ctDisplay = ct.displayName?.toLowerCase() || '';
      
      // Exact match
      if (ctName === normalized) score += 100;
      if (ctDisplay === normalized) score += 90;
      
      // Contains match
      if (ctName.includes(normalized)) score += 50;
      if (ctDisplay.includes(normalized)) score += 40;
      
      // Reverse contains (requested type contains content type)
      if (normalized.includes(ctName)) score += 30;
      
      // Generic pattern matching (not hardcoded types)
      for (const [pattern, keywords] of Object.entries(GENERIC_TYPE_PATTERNS)) {
        if (normalized.includes(pattern)) {
          for (const keyword of keywords) {
            if (ctName.includes(keyword)) score += 20;
          }
        }
      }
      
      // Context matching
      if (params.context) {
        const ctx = params.context.toLowerCase();
        const words = ctx.split(/\s+/);
        for (const word of words) {
          if (ctName.includes(word) || ctDisplay.includes(word)) {
            score += 10;
          }
        }
      }
      
      return { contentType: ct, score };
    });
    
    // Sort by score and get top matches
    const topMatches = scores
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    
    if (topMatches.length === 0) {
      // No matches found, show available types
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            requestedType: params.requestedType,
            message: `No content types found matching "${params.requestedType}"`,
            availableTypes: contentTypes.slice(0, 10).map(ct => ({
              name: ct.key,
              displayName: ct.displayName,
              baseType: ct.baseType
            })),
            totalAvailable: contentTypes.length,
            hint: 'Use type-discover to see all available content types in your CMS'
          }, null, 2)
        }]
      };
    }
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          requestedType: params.requestedType,
          bestMatch: {
            name: topMatches[0].contentType.key,
            displayName: topMatches[0].contentType.displayName,
            confidence: Math.min(topMatches[0].score, 100) + '%'
          },
          alternatives: topMatches.slice(1).map(match => ({
            name: match.contentType.key,
            displayName: match.contentType.displayName,
            confidence: Math.min(match.score, 100) + '%'
          })),
          recommendation: topMatches[0].contentType.key,
          message: topMatches[0].score >= 90 
            ? `High confidence match: ${topMatches[0].contentType.key}`
            : `Best match found: ${topMatches[0].contentType.key}. Consider confirming with the user.`
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}