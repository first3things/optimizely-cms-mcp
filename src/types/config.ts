import { z } from 'zod';

export const ConfigSchema = z.object({
  server: z.object({
    name: z.string().default('optimizely-mcp-server'),
    version: z.string().default('1.0.0'),
    transport: z.enum(['stdio', 'sse', 'streamable-http']).default('stdio')
  }),
  graph: z.object({
    endpoint: z.string().url(),
    authMethod: z.enum(['single_key', 'hmac', 'basic', 'bearer', 'oidc']),
    credentials: z.object({
      singleKey: z.string().optional(),
      appKey: z.string().optional(),
      secret: z.string().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
      token: z.string().optional()
    })
  }),
  cma: z.object({
    baseUrl: z.string().url(),
    clientId: z.string(),
    clientSecret: z.string(),
    grantType: z.string().default('client_credentials'),
    tokenEndpoint: z.string().url().optional()
  }),
  options: z.object({
    cacheTtl: z.number().default(300),
    maxRetries: z.number().default(3),
    timeout: z.number().default(30000),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info')
  })
});

export type Config = z.infer<typeof ConfigSchema>;

export interface GraphConfig {
  endpoint: string;
  auth: AuthConfig;
  timeout?: number;
  maxRetries?: number;
}

export interface AuthConfig {
  method: 'single_key' | 'hmac' | 'basic' | 'bearer' | 'oidc';
  singleKey?: string;
  appKey?: string;
  secret?: string;
  username?: string;
  password?: string;
  token?: string;
}

export interface CMAConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  grantType: string;
  tokenEndpoint?: string;
  timeout?: number;
  maxRetries?: number;
}