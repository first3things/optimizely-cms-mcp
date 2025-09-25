import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OptimizelyContentClient } from '../../clients/cma-client.js';
import { CMAConfig } from '../../types/config.js';
import { handleError } from '../../utils/errors.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();

// Common content type patterns
const CONTENT_TYPE_PATTERNS = {
  'article': ['Article', 'ArticlePage', 'BlogPost', 'BlogArticle', 'NewsArticle'],
  'page': ['Page', 'StandardPage', 'ContentPage', 'BasicPage', 'LandingPage'],
  'product': ['Product', 'ProductPage', 'ProductDetail', 'ProductListing'],
  'blog': ['BlogPost', 'BlogPage', 'BlogArticle', 'BlogEntry'],
  'news': ['NewsPage', 'NewsArticle', 'NewsItem', 'PressRelease'],
  'standard': ['StandardPage', 'Page', 'BasicPage'],
  'home': ['HomePage', 'StartPage', 'FrontPage'],
  'landing': ['LandingPage', 'CampaignPage', 'MarketingPage']
};

export async function executeContentTypeDiscovery(
  config: CMAConfig,
  params: { suggestedType?: string; includeDescriptions?: boolean }
): Promise<CallToolResult> {
  try {
    const client = new OptimizelyContentClient(config);
    
    logger.info('Discovering content types', { suggestedType: params.suggestedType });
    
    // Get all content types
    const contentTypes = await client.get('/contenttypes');
    
    // If a suggested type is provided, try to find matches
    if (params.suggestedType) {
      const suggested = params.suggestedType.toLowerCase();
      const matches = [];
      
      // Check patterns
      for (const [key, patterns] of Object.entries(CONTENT_TYPE_PATTERNS)) {
        if (suggested.includes(key)) {
          for (const pattern of patterns) {
            const found = contentTypes.find(ct => 
              ct.name?.toLowerCase() === pattern.toLowerCase() ||
              ct.displayName?.toLowerCase() === pattern.toLowerCase()
            );
            if (found) {
              matches.push(found);
            }
          }
        }
      }
      
      // Also check direct matches
      const directMatch = contentTypes.find(ct => 
        ct.name?.toLowerCase().includes(suggested) ||
        ct.displayName?.toLowerCase().includes(suggested)
      );
      if (directMatch && !matches.includes(directMatch)) {
        matches.push(directMatch);
      }
      
      if (matches.length > 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              suggestedType: params.suggestedType,
              matches: matches.map(ct => ({
                name: ct.name,
                displayName: ct.displayName,
                description: ct.description,
                baseType: ct.baseType
              })),
              recommendation: matches[0].name,
              message: `Found ${matches.length} content type(s) matching "${params.suggestedType}". Recommended: ${matches[0].name}`
            }, null, 2)
          }]
        };
      }
    }
    
    // Return all content types
    const pageTypes = contentTypes.filter(ct => 
      ct.baseType === 'Page' || 
      ct.name?.includes('Page') ||
      ct.displayName?.includes('Page')
    );
    
    const blockTypes = contentTypes.filter(ct => 
      ct.baseType === 'Block' || 
      ct.name?.includes('Block') ||
      ct.displayName?.includes('Block')
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
            name: ct.name,
            displayName: ct.displayName,
            description: params.includeDescriptions ? ct.description : undefined
          })),
          blockTypes: blockTypes.map(ct => ({
            name: ct.name,
            displayName: ct.displayName,
            description: params.includeDescriptions ? ct.description : undefined
          })),
          commonSuggestions: Object.keys(CONTENT_TYPE_PATTERNS),
          message: params.suggestedType 
            ? `No exact match found for "${params.suggestedType}". Showing all available types.`
            : 'Available content types listed by category.'
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
    
    // Get all content types
    const contentTypes = await client.get('/contenttypes');
    
    // Score each content type
    const scores = contentTypes.map(ct => {
      let score = 0;
      const ctName = ct.name?.toLowerCase() || '';
      const ctDisplay = ct.displayName?.toLowerCase() || '';
      
      // Exact match
      if (ctName === normalized) score += 100;
      if (ctDisplay === normalized) score += 90;
      
      // Contains match
      if (ctName.includes(normalized)) score += 50;
      if (ctDisplay.includes(normalized)) score += 40;
      
      // Pattern match
      for (const [key, patterns] of Object.entries(CONTENT_TYPE_PATTERNS)) {
        if (normalized.includes(key) && patterns.includes(ct.name)) {
          score += 30;
        }
      }
      
      // Context matching
      if (params.context) {
        const ctx = params.context.toLowerCase();
        if (ctx.includes('blog') && ctName.includes('blog')) score += 20;
        if (ctx.includes('news') && ctName.includes('news')) score += 20;
        if (ctx.includes('product') && ctName.includes('product')) score += 20;
        if (ctx.includes('article') && (ctName.includes('article') || ctName.includes('blog'))) score += 20;
      }
      
      return { contentType: ct, score };
    });
    
    // Sort by score and get top matches
    const topMatches = scores
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    
    if (topMatches.length === 0) {
      // No matches found, suggest common types
      const commonTypes = contentTypes.filter(ct => 
        ['StandardPage', 'ArticlePage', 'Page', 'BlogPost'].includes(ct.name)
      );
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            requestedType: params.requestedType,
            message: `No content types found matching "${params.requestedType}"`,
            suggestions: commonTypes.map(ct => ({
              name: ct.name,
              displayName: ct.displayName,
              reason: 'Common content type'
            })),
            hint: 'Try using common terms like: page, article, blog, product, news'
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
            name: topMatches[0].contentType.name,
            displayName: topMatches[0].contentType.displayName,
            confidence: Math.min(topMatches[0].score, 100) + '%'
          },
          alternatives: topMatches.slice(1).map(match => ({
            name: match.contentType.name,
            displayName: match.contentType.displayName,
            confidence: Math.min(match.score, 100) + '%'
          })),
          recommendation: topMatches[0].contentType.name,
          message: topMatches[0].score >= 90 
            ? `High confidence match: ${topMatches[0].contentType.name}`
            : `Best match found: ${topMatches[0].contentType.name}. Consider confirming with the user.`
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}