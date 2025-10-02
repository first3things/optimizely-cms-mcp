import { z } from 'zod';
import { BaseTool, ToolContext } from '../base-tool.js';
import { getGraphConfig, getCMAConfig } from '../../config.js';
import { OptimizelyGraphClient } from '../../clients/graph-client.js';
import { CMAClient } from '../../clients/cma-client.js';

// Input schema for the health check tool
const healthCheckSchema = z.object({
  // No input parameters required
});

type HealthCheckInput = z.infer<typeof healthCheckSchema>;

interface HealthCheckOutput {
  status: 'healthy' | 'degraded' | 'unhealthy';
  server: {
    name: string;
    version: string;
  };
  apis: {
    graph: {
      status: 'ok' | 'error';
      endpoint: string;
      authMethod: string;
      error?: string;
    };
    cma: {
      status: 'ok' | 'error';
      baseUrl: string;
      hasToken: boolean;
      error?: string;
    };
  };
  configuration: {
    cacheEnabled: boolean;
    cacheTtl: number;
  };
  timestamp: string;
}

export class HealthCheckTool extends BaseTool<HealthCheckInput, HealthCheckOutput> {
  protected readonly name = 'health';
  protected readonly description = 'Check system health and API connectivity';
  protected readonly inputSchema = healthCheckSchema;
  
  protected async run(input: HealthCheckInput, context: ToolContext): Promise<HealthCheckOutput> {
    const { config } = context;
    
    this.reportProgress('Checking system health...');
    
    // Check Graph API
    const graphStatus = await this.checkGraphAPI(config);
    this.reportProgress('Graph API check complete', 33);
    
    // Check CMA API
    const cmaStatus = await this.checkCMAAPI(config);
    this.reportProgress('CMA API check complete', 66);
    
    // Determine overall status
    const overallStatus = this.determineOverallStatus(graphStatus, cmaStatus);
    this.reportProgress('Health check complete', 100);
    
    return {
      status: overallStatus,
      server: {
        name: config.server.name,
        version: config.server.version
      },
      apis: {
        graph: graphStatus,
        cma: cmaStatus
      },
      configuration: {
        cacheEnabled: true,
        cacheTtl: config.options.cacheTtl
      },
      timestamp: new Date().toISOString()
    };
  }
  
  private async checkGraphAPI(config: any): Promise<HealthCheckOutput['apis']['graph']> {
    try {
      const graphConfig = getGraphConfig(config);
      const client = new OptimizelyGraphClient(graphConfig);
      
      // Try a simple introspection query
      await client.introspect();
      
      return {
        status: 'ok',
        endpoint: graphConfig.endpoint,
        authMethod: graphConfig.auth.method
      };
    } catch (error: any) {
      return {
        status: 'error',
        endpoint: config.graph.endpoint,
        authMethod: config.graph.authMethod,
        error: error.message
      };
    }
  }
  
  private async checkCMAAPI(config: any): Promise<HealthCheckOutput['apis']['cma']> {
    try {
      const cmaConfig = getCMAConfig(config);
      const client = new CMAClient(cmaConfig);
      
      // Check if we can get a token
      const hasToken = await client.testConnection();
      
      return {
        status: 'ok',
        baseUrl: cmaConfig.baseUrl,
        hasToken
      };
    } catch (error: any) {
      return {
        status: 'error',
        baseUrl: config.cma.baseUrl,
        hasToken: false,
        error: error.message
      };
    }
  }
  
  private determineOverallStatus(
    graphStatus: HealthCheckOutput['apis']['graph'],
    cmaStatus: HealthCheckOutput['apis']['cma']
  ): HealthCheckOutput['status'] {
    if (graphStatus.status === 'ok' && cmaStatus.status === 'ok') {
      return 'healthy';
    }
    
    if (graphStatus.status === 'error' && cmaStatus.status === 'error') {
      return 'unhealthy';
    }
    
    return 'degraded';
  }
}