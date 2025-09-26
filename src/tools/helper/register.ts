import { Tool } from '@modelcontextprotocol/sdk/types.js';

export function getHelperTools(): Tool[] {
  return [
    {
      name: 'get-full-content-by-path',
      description: 'Get FULL content including composition data by URL path in ONE STEP.\n\n✅ This combines graph-get-content-by-path and content-get automatically!\n\nReturns:\n- Complete content structure\n- Composition/visual builder data\n- All properties and fields\n- Metadata\n\nExamples:\n- Homepage: {"path": "/"}\n- About page: {"path": "/about"}\n- With locale: {"path": "/", "locale": "en"}\n\nUse this when you need full content data and know the URL path.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'URL path (e.g., "/" for homepage)'
          },
          locale: {
            type: 'string',
            description: 'Language locale (default: "en")',
            default: 'en'
          }
        },
        required: ['path'],
        additionalProperties: false
      }
    }
  ];
}