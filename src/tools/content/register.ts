import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from '../../types/tools.js';
import { getCMAConfig } from '../../config.js';
import {
  executeContentCreate,
  executeContentGet,
  executeContentUpdate,
  executeContentPatch,
  executeContentDelete,
  executeContentMove,
  executeContentCopy
} from '../../logic/content/crud.js';
import {
  executeContentListVersions,
  executeContentCreateVersion,
  executeContentPromoteVersion,
  executeContentListLanguages,
  executeContentCreateLanguageBranch
} from '../../logic/content/versions.js';
import {
  executeTypeList,
  executeTypeGet,
  executeTypeGetSchema
} from '../../logic/types/operations.js';
import {
  executeWorkflowGetStatus,
  executeWorkflowTransition
} from '../../logic/workflow/operations.js';
import {
  executeGetSiteInfo,
  executeTestContentApi
} from '../../logic/content/site-info.js';

export function getContentTools(): Tool[] {
  return [
    // Site Information Tools
    {
      name: 'content-site-info',
      description: 'Get guidance on finding container GUIDs and using the Content Management API',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    {
      name: 'content-test-api',
      description: 'Test Content Management API connectivity and available endpoints',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    
    // Content CRUD Operations
    {
      name: 'content-create',
      description: 'Create new content items. IMPORTANT: Requires a container GUID. Use the Optimizely CMS admin to find valid container GUIDs.',
      inputSchema: {
        type: 'object',
        properties: {
          contentType: {
            type: ['string', 'array'],
            items: { type: 'string' },
            description: 'Content type identifier (e.g., "StandardPage", "ArticlePage")'
          },
          name: {
            type: 'string',
            description: 'Content name (internal identifier)'
          },
          displayName: {
            type: 'string',
            description: 'Display name (shown in UI)'
          },
          container: {
            type: 'string',
            description: 'Parent container GUID (required). Example: "12345678-1234-1234-1234-123456789012"'
          },
          parentId: {
            type: ['string', 'integer'],
            description: 'Alternative to container - must be a GUID'
          },
          properties: {
            type: 'object',
            description: 'Content properties (MainBody, Title, etc.)',
            additionalProperties: true
          },
          language: {
            type: 'string',
            description: 'Content language code (default: "en")',
            default: 'en'
          }
        },
        required: ['contentType', 'name'],
        additionalProperties: false
      }
    },
    {
      name: 'content-get',
      description: 'Retrieve content details from CMA',
      inputSchema: {
        type: 'object',
        properties: {
          contentId: {
            type: ['string', 'integer'],
            description: 'Content ID'
          },
          language: {
            type: 'string',
            description: 'Language branch (optional)'
          },
          version: {
            type: 'string',
            description: 'Specific version (optional)'
          }
        },
        required: ['contentId'],
        additionalProperties: false
      }
    },
    {
      name: 'content-update',
      description: 'Update existing content',
      inputSchema: {
        type: 'object',
        properties: {
          contentId: {
            type: ['string', 'integer'],
            description: 'Content ID'
          },
          properties: {
            type: 'object',
            description: 'Updated properties',
            additionalProperties: true
          },
          name: {
            type: 'string',
            description: 'New content name (optional)'
          },
          language: {
            type: 'string',
            description: 'Language branch (optional)'
          },
          createVersion: {
            type: 'boolean',
            description: 'Create new version (optional)',
            default: false
          }
        },
        required: ['contentId'],
        additionalProperties: false
      }
    },
    {
      name: 'content-patch',
      description: 'Partially update content fields using JSON Patch',
      inputSchema: {
        type: 'object',
        properties: {
          contentId: {
            type: ['string', 'integer'],
            description: 'Content ID'
          },
          patches: {
            type: 'array',
            description: 'JSON Patch operations',
            items: {
              type: 'object',
              properties: {
                op: {
                  type: 'string',
                  enum: ['add', 'remove', 'replace', 'move', 'copy', 'test']
                },
                path: {
                  type: 'string',
                  pattern: '^/[a-zA-Z0-9_/]+$'
                },
                value: {
                  description: 'Value for the operation'
                },
                from: {
                  type: 'string',
                  description: 'Source path for move/copy operations'
                }
              },
              required: ['op', 'path']
            }
          },
          language: {
            type: 'string',
            description: 'Language branch (optional)'
          }
        },
        required: ['contentId', 'patches'],
        additionalProperties: false
      }
    },
    {
      name: 'content-delete',
      description: 'Delete content items',
      inputSchema: {
        type: 'object',
        properties: {
          contentId: {
            type: ['string', 'integer'],
            description: 'Content ID'
          },
          permanent: {
            type: 'boolean',
            description: 'Skip recycle bin',
            default: false
          },
          includeDescendants: {
            type: 'boolean',
            description: 'Delete child content',
            default: false
          }
        },
        required: ['contentId'],
        additionalProperties: false
      }
    },
    {
      name: 'content-move',
      description: 'Move content to new location',
      inputSchema: {
        type: 'object',
        properties: {
          contentId: {
            type: ['string', 'integer'],
            description: 'Content to move'
          },
          targetId: {
            type: ['string', 'integer'],
            description: 'New parent ID'
          },
          createRedirect: {
            type: 'boolean',
            description: 'Create URL redirect',
            default: false
          }
        },
        required: ['contentId', 'targetId'],
        additionalProperties: false
      }
    },
    {
      name: 'content-copy',
      description: 'Copy content to new location',
      inputSchema: {
        type: 'object',
        properties: {
          contentId: {
            type: ['string', 'integer'],
            description: 'Content to copy'
          },
          targetId: {
            type: ['string', 'integer'],
            description: 'Destination parent'
          },
          includeDescendants: {
            type: 'boolean',
            description: 'Copy child content',
            default: false
          },
          newName: {
            type: 'string',
            description: 'Name for the copy (optional)'
          }
        },
        required: ['contentId', 'targetId'],
        additionalProperties: false
      }
    },
    
    // Version Management
    {
      name: 'content-list-versions',
      description: 'List all content versions',
      inputSchema: {
        type: 'object',
        properties: {
          contentId: {
            type: ['string', 'integer'],
            description: 'Content ID'
          },
          language: {
            type: 'string',
            description: 'Language filter (optional)'
          }
        },
        required: ['contentId'],
        additionalProperties: false
      }
    },
    {
      name: 'content-create-version',
      description: 'Create a new content version',
      inputSchema: {
        type: 'object',
        properties: {
          contentId: {
            type: ['string', 'integer'],
            description: 'Content ID'
          },
          language: {
            type: 'string',
            description: 'Language branch'
          },
          basedOn: {
            type: 'string',
            description: 'Source version (optional)'
          }
        },
        required: ['contentId', 'language'],
        additionalProperties: false
      }
    },
    {
      name: 'content-promote-version',
      description: 'Promote version to primary',
      inputSchema: {
        type: 'object',
        properties: {
          contentId: {
            type: ['string', 'integer'],
            description: 'Content ID'
          },
          version: {
            type: 'string',
            description: 'Version to promote'
          },
          language: {
            type: 'string',
            description: 'Language branch'
          }
        },
        required: ['contentId', 'version', 'language'],
        additionalProperties: false
      }
    },
    
    // Language Management
    {
      name: 'content-list-languages',
      description: 'List available content languages',
      inputSchema: {
        type: 'object',
        properties: {
          contentId: {
            type: ['string', 'integer'],
            description: 'Filter by content (optional)'
          }
        },
        additionalProperties: false
      }
    },
    {
      name: 'content-create-language-branch',
      description: 'Create content in new language',
      inputSchema: {
        type: 'object',
        properties: {
          contentId: {
            type: ['string', 'integer'],
            description: 'Content ID'
          },
          language: {
            type: 'string',
            description: 'Target language code'
          },
          sourceLanguage: {
            type: 'string',
            description: 'Copy from language (optional)'
          }
        },
        required: ['contentId', 'language'],
        additionalProperties: false
      }
    },
    
    // Content Type Tools
    {
      name: 'type-list',
      description: 'List all content types',
      inputSchema: {
        type: 'object',
        properties: {
          includeSystemTypes: {
            type: 'boolean',
            description: 'Include system types',
            default: false
          }
        },
        additionalProperties: false
      }
    },
    {
      name: 'type-get',
      description: 'Get content type details',
      inputSchema: {
        type: 'object',
        properties: {
          typeId: {
            type: 'string',
            description: 'Content type ID'
          }
        },
        required: ['typeId'],
        additionalProperties: false
      }
    },
    {
      name: 'type-get-schema',
      description: 'Get JSON schema for content type',
      inputSchema: {
        type: 'object',
        properties: {
          typeId: {
            type: 'string',
            description: 'Content type ID'
          }
        },
        required: ['typeId'],
        additionalProperties: false
      }
    },
    
    // Workflow Tools
    {
      name: 'workflow-get-status',
      description: 'Get content workflow status',
      inputSchema: {
        type: 'object',
        properties: {
          contentId: {
            type: ['string', 'integer'],
            description: 'Content ID'
          }
        },
        required: ['contentId'],
        additionalProperties: false
      }
    },
    {
      name: 'workflow-transition',
      description: 'Move content through workflow',
      inputSchema: {
        type: 'object',
        properties: {
          contentId: {
            type: ['string', 'integer'],
            description: 'Content ID'
          },
          action: {
            type: 'string',
            description: 'Workflow action ID'
          },
          comment: {
            type: 'string',
            description: 'Transition comment (optional)'
          }
        },
        required: ['contentId', 'action'],
        additionalProperties: false
      }
    }
  ];
}

export function registerContentHandlers(
  handlers: Map<string, (params: any, context: ToolContext) => Promise<any>>
): void {
  const cmaConfig = (context: ToolContext) => getCMAConfig(context.config);

  // Site information handlers
  handlers.set('content-site-info', async (params, context) => 
    executeGetSiteInfo(cmaConfig(context), params)
  );
  
  handlers.set('content-test-api', async (params, context) => 
    executeTestContentApi(cmaConfig(context), params)
  );

  // Content CRUD handlers
  handlers.set('content-create', async (params, context) => 
    executeContentCreate(cmaConfig(context), params)
  );
  
  handlers.set('content-get', async (params, context) => 
    executeContentGet(cmaConfig(context), params)
  );
  
  handlers.set('content-update', async (params, context) => 
    executeContentUpdate(cmaConfig(context), params)
  );
  
  handlers.set('content-patch', async (params, context) => 
    executeContentPatch(cmaConfig(context), params)
  );
  
  handlers.set('content-delete', async (params, context) => 
    executeContentDelete(cmaConfig(context), params)
  );
  
  handlers.set('content-move', async (params, context) => 
    executeContentMove(cmaConfig(context), params)
  );
  
  handlers.set('content-copy', async (params, context) => 
    executeContentCopy(cmaConfig(context), params)
  );
  
  // Version management handlers
  handlers.set('content-list-versions', async (params, context) => 
    executeContentListVersions(cmaConfig(context), params)
  );
  
  handlers.set('content-create-version', async (params, context) => 
    executeContentCreateVersion(cmaConfig(context), params)
  );
  
  handlers.set('content-promote-version', async (params, context) => 
    executeContentPromoteVersion(cmaConfig(context), params)
  );
  
  // Language management handlers
  handlers.set('content-list-languages', async (params, context) => 
    executeContentListLanguages(cmaConfig(context), params)
  );
  
  handlers.set('content-create-language-branch', async (params, context) => 
    executeContentCreateLanguageBranch(cmaConfig(context), params)
  );
  
  // Type handlers
  handlers.set('type-list', async (params, context) => 
    executeTypeList(cmaConfig(context), params)
  );
  
  handlers.set('type-get', async (params, context) => 
    executeTypeGet(cmaConfig(context), params)
  );
  
  handlers.set('type-get-schema', async (params, context) => 
    executeTypeGetSchema(cmaConfig(context), params)
  );
  
  // Workflow handlers
  handlers.set('workflow-get-status', async (params, context) => 
    executeWorkflowGetStatus(cmaConfig(context), params)
  );
  
  handlers.set('workflow-transition', async (params, context) => 
    executeWorkflowTransition(cmaConfig(context), params)
  );
}