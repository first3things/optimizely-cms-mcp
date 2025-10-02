import { z } from 'zod';
import { BaseTool } from '../base-tool.js';
import type { ToolContext } from '../../types/tools.js';

/**
 * Help tool - Provides guidance on using Optimizely CMS tools effectively
 * 
 * This tool helps users understand:
 * - The discovery-first workflow
 * - How to use each tool properly
 * - Common patterns and best practices
 * - Troubleshooting tips
 */
export class HelpTool extends BaseTool<HelpInput, HelpOutput> {
  protected readonly name = 'help';
  protected readonly description = `Get help with using Optimizely CMS tools.

Examples:
- help({"topic": "workflow"}) - Learn the discovery-first workflow
- help({"topic": "search"}) - How to search for content
- help({"topic": "tools"}) - List all available tools
- help({}) - General help and best practices`;

  protected readonly inputSchema = z.object({
    topic: z.enum(['workflow', 'search', 'tools', 'errors', 'examples']).optional()
      .describe('Specific help topic')
  });

  protected async run(input: HelpInput, context: ToolContext): Promise<HelpOutput> {
    const topic = input.topic || 'general';
    
    const helpContent = this.getHelpContent(topic);
    
    return {
      topic,
      content: helpContent,
      relatedTopics: this.getRelatedTopics(topic)
    };
  }

  private getHelpContent(topic: string): string {
    const helpTexts: Record<string, string> = {
      general: `
# Optimizely CMS Tools - Quick Start Guide

Welcome! These tools use a **discovery-first approach** to work with ANY Optimizely CMS.

## 🚀 Key Principle: Always Discover First!

Never assume field names or content types. Always discover what's available:

1. **discover** - Find out what's in your CMS
2. **search/locate** - Find specific content
3. **retrieve** - Get full content details

## Quick Examples

### Find and search for articles:
\`\`\`
1. discover({"target": "types"})
   // Returns: ArticlePage, NewsPage, BlogPost, etc.

2. discover({"target": "fields", "contentType": "ArticlePage"})
   // Returns: Heading, Author, Body, PublishDate, etc.

3. search({"query": "product launch", "contentTypes": ["ArticlePage"]})
   // Returns: Matching articles with metadata
\`\`\`

### Get specific content:
\`\`\`
1. locate({"identifier": "/news/2024/big-announcement"})
   // Returns: Content metadata and ID

2. retrieve({"identifier": "12345", "includeSchema": true})
   // Returns: Full content with all properties
\`\`\`

Need more help? Try: help({"topic": "workflow"})`,

      workflow: `
# Discovery-First Workflow

## The Golden Rule: Never Assume, Always Discover! 🔍

### Step 1: Discover What's Available
\`\`\`
discover({"target": "types"})
\`\`\`
This shows you ALL content types in the CMS. No guessing!

### Step 2: Explore Content Type Details
\`\`\`
discover({"target": "fields", "contentType": "ArticlePage"})
\`\`\`
See what fields are actually available. Common fields vary by CMS!

### Step 3: Search with Confidence
\`\`\`
search({
  "query": "your search terms",
  "contentTypes": ["ArticlePage", "NewsPage"],
  "locale": "en"
})
\`\`\`
Now you know exactly which types and fields exist!

### Step 4: Get Full Content
\`\`\`
retrieve({"identifier": "content-id-from-search"})
\`\`\`

## Why This Workflow?

- ✅ Works with ANY Optimizely CMS
- ✅ No hardcoded assumptions
- ✅ Discovers custom fields automatically
- ✅ Adapts to your specific schema

## Common Mistakes to Avoid

❌ DON'T assume field names like "Title" or "Description"
✅ DO discover actual field names first

❌ DON'T use legacy graph-query tool
✅ DO use the new search tool

❌ DON'T guess content type names
✅ DO discover available types first`,

      search: `
# How to Search Content

## Always Start with Discovery!

### Step 1: Find Available Content Types
\`\`\`
discover({"target": "types"})
\`\`\`

### Step 2: Understand the Fields
\`\`\`
discover({"target": "fields", "contentType": "ArticlePage"})
\`\`\`

### Step 3: Search with the Right Fields

#### Basic Search (full-text):
\`\`\`
search({
  "query": "model context protocol",
  "contentTypes": ["ArticlePage"]
})
\`\`\`

#### Advanced Search with Filters:
\`\`\`
search({
  "query": "mcp",
  "contentTypes": ["ArticlePage", "BlogPost"],
  "filters": {
    "Author": "John Doe",
    "PublishDate": {"gte": "2024-01-01"}
  },
  "orderBy": {
    "field": "published",
    "direction": "DESC"
  }
})
\`\`\`

#### Search with Facets:
\`\`\`
search({
  "query": "optimization",
  "includeFacets": true,
  "includeTotal": true
})
\`\`\`

## Pro Tips

1. **Use discovered field names** - Don't assume "title", check what's actually there
2. **Filter by content type** - More efficient than searching everything
3. **Use facets** - Great for understanding content distribution
4. **Check searchable fields** - Not all fields can be searched

## If Search Returns No Results

1. Check your content type names are correct
2. Verify the fields you're filtering on exist
3. Try a broader search term
4. Use discover to see example content`,

      tools: `
# Available Tools

## 🔍 Discovery & Analysis
- **discover** - Find content types, fields, and schemas
- **analyze** - Deep analysis of content types
- **health** - Check system connectivity

## 🔎 Search & Retrieval  
- **search** - Full-text and filtered content search
- **locate** - Find content by ID/path/GUID
- **retrieve** - Get complete content from CMA

## 📝 Content Management (Coming Soon)
- **create** - Create new content
- **update** - Update existing content
- **manage** - Delete, copy, move operations

## Tool Categories

### Start Here (Discovery)
1. **discover** - ALWAYS use this first!
2. **analyze** - Understand content type details

### Find Content
1. **search** - When you need to find content by text/filters
2. **locate** - When you have a specific ID or path

### Work with Content
1. **retrieve** - Get full editable content
2. **create/update/manage** - Modify content

## Legacy Tools (Avoid These)
- graph-query ❌ → Use **search** instead
- graph-get-by-id ❌ → Use **locate** instead
- content-get ❌ → Use **retrieve** instead`,

      errors: `
# Common Errors and Solutions

## GraphQL Field Errors

### Error: "Cannot query field 'Name' on type '_ContentWhereInput'"
**Cause**: Using incorrect field names
**Solution**: 
\`\`\`
1. discover({"target": "fields", "contentType": "ArticlePage"})
2. Use the actual field names returned (e.g., "Heading" not "Name")
\`\`\`

### Error: "Unknown type 'IContent'"
**Cause**: Using wrong GraphQL type names
**Solution**: Use **_IContent** (with underscore) or discover exact type names

## Discovery Errors

### Error: "Content type not found"
**Cause**: Typo in content type name
**Solution**:
\`\`\`
1. discover({"target": "types"})
2. Copy the exact type name from the results
\`\`\`

## Search Errors

### Error: "No results found"
**Possible Causes**:
1. Content doesn't exist
2. Wrong field names in filters
3. Content not published

**Solutions**:
1. Try broader search terms
2. Remove filters and search again
3. Check content status with locate tool

## Best Practices to Avoid Errors

1. **Always discover first** - Don't assume anything
2. **Use exact names** - Copy from discovery results
3. **Check field types** - Some fields aren't searchable
4. **Verify content exists** - Use locate for specific items`,

      examples: `
# Real-World Examples

## Example 1: Find Articles About "AI"

\`\`\`
// Step 1: Discover article types
discover({"target": "types"})
// Found: ArticlePage, BlogPost, NewsItem

// Step 2: Check ArticlePage fields
discover({"target": "fields", "contentType": "ArticlePage"})
// Found: Heading, SubHeading, Author, Body, Tags

// Step 3: Search for AI articles
search({
  "query": "artificial intelligence AI",
  "contentTypes": ["ArticlePage", "BlogPost"],
  "limit": 10
})
\`\`\`

## Example 2: Get Today's News

\`\`\`
// Step 1: Find news content type
discover({"target": "types"})
// Found: NewsItem

// Step 2: Check date field name
discover({"target": "fields", "contentType": "NewsItem"})
// Found: PublishDate field

// Step 3: Search today's news
search({
  "contentTypes": ["NewsItem"],
  "filters": {
    "PublishDate": {
      "gte": "2024-01-02T00:00:00Z",
      "lt": "2024-01-03T00:00:00Z"
    }
  },
  "orderBy": {
    "field": "PublishDate",
    "direction": "DESC"
  }
})
\`\`\`

## Example 3: Find and Update Content

\`\`\`
// Step 1: Find content by path
locate({"identifier": "/about-us/team"})
// Returns: { id: "12345", displayName: "Our Team" }

// Step 2: Get full content
retrieve({
  "identifier": "12345",
  "includeSchema": true,
  "includeVersions": true
})
// Returns: Complete content with all properties

// Step 3: Update (coming soon)
update({
  "identifier": "12345",
  "properties": {
    "LastUpdated": "2024-01-02"
  }
})
\`\`\`

## Example 4: Content Analysis

\`\`\`
// Analyze a content type thoroughly
analyze({
  "contentType": "ProductPage",
  "includeExamples": true,
  "generateDefaults": true
})
// Returns: Field categories, requirements, recommendations
\`\`\``
    };

    return helpTexts[topic] || helpTexts.general;
  }

  private getRelatedTopics(topic: string): string[] {
    const related: Record<string, string[]> = {
      general: ['workflow', 'tools', 'examples'],
      workflow: ['search', 'examples', 'errors'],
      search: ['workflow', 'errors', 'examples'],
      tools: ['workflow', 'search'],
      errors: ['workflow', 'search', 'examples'],
      examples: ['workflow', 'search', 'tools']
    };

    return related[topic] || ['workflow', 'tools'];
  }
}

// Type definitions
interface HelpInput {
  topic?: 'workflow' | 'search' | 'tools' | 'errors' | 'examples';
}

interface HelpOutput {
  topic: string;
  content: string;
  relatedTopics: string[];
}