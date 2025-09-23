import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OptimizelyContentClient } from '../../clients/cma-client.js';
import { CMAConfig } from '../../types/config.js';
import { WorkflowTransitionRequest } from '../../types/optimizely.js';
import { handleError, ValidationError } from '../../utils/errors.js';
import { validateInput } from '../../utils/validation.js';
import { z } from 'zod';

interface WorkflowStatus {
  contentId: string;
  state: string;
  stateName: string;
  availableActions: WorkflowAction[];
  history: WorkflowHistoryItem[];
}

interface WorkflowAction {
  id: string;
  name: string;
  description?: string;
  requiresComment: boolean;
}

interface WorkflowHistoryItem {
  action: string;
  actionName: string;
  performedBy: string;
  performedDate: string;
  comment?: string;
  fromState: string;
  toState: string;
}

const WorkflowStatusSchema = z.object({
  contentId: z.union([z.string(), z.number()])
});

const WorkflowTransitionSchema = z.object({
  contentId: z.union([z.string(), z.number()]),
  action: z.string(),
  comment: z.string().optional()
});

export async function executeWorkflowGetStatus(
  config: CMAConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const validatedParams = validateInput(WorkflowStatusSchema, params);
    const client = new OptimizelyContentClient(config);
    
    const status = await client.get<WorkflowStatus>(
      `/content/${validatedParams.contentId}/workflow`
    );
    
    // Enhance with additional context
    const enhancedStatus = {
      ...status,
      summary: {
        currentState: status.stateName,
        availableActionCount: status.availableActions.length,
        historyCount: status.history.length,
        lastAction: status.history[0] || null,
        canTransition: status.availableActions.length > 0
      }
    };
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(enhancedStatus, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function executeWorkflowTransition(
  config: CMAConfig,
  params: any
): Promise<CallToolResult> {
  try {
    const validatedParams = validateInput(WorkflowTransitionSchema, params);
    const client = new OptimizelyContentClient(config);
    
    // First, check if the action is valid
    const currentStatus = await client.get<WorkflowStatus>(
      `/content/${validatedParams.contentId}/workflow`
    );
    
    const action = currentStatus.availableActions.find(a => a.id === validatedParams.action);
    if (!action) {
      throw new ValidationError(
        `Invalid workflow action: ${validatedParams.action}. Available actions: ${
          currentStatus.availableActions.map(a => a.id).join(', ')
        }`
      );
    }
    
    // Check if comment is required
    if (action.requiresComment && !validatedParams.comment) {
      throw new ValidationError(`Comment is required for action: ${action.name}`);
    }
    
    const request: WorkflowTransitionRequest = {
      action: validatedParams.action,
      comment: validatedParams.comment
    };
    
    const result = await client.post<WorkflowStatus>(
      `/content/${validatedParams.contentId}/workflow/transition`,
      request
    );
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Workflow transition completed successfully`,
          previousState: currentStatus.stateName,
          newState: result.stateName,
          action: action.name,
          comment: validatedParams.comment,
          result
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleError(error);
  }
}