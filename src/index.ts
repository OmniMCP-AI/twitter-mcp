#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport, StreamableHTTPServerTransportOptions } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import http from 'http';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  Tool,
  ErrorCode,
  McpError,
  TextContent
} from '@modelcontextprotocol/sdk/types.js';
import { TwitterClient } from './twitter-api.js';
import { ResponseFormatter } from './formatter.js';
import { OAuth2Helper } from './oauth2.js';
import {
  Config, ConfigSchema,
  PostTweetSchema, SearchTweetsSchema,
  TwitterError
} from './types.js';
import dotenv from 'dotenv';
import {randomUUID} from "node:crypto";

export class TwitterServer {
  private server: Server;
  // private client: TwitterClient;

  constructor(config: Config) {
    // Validate config
    // const result = ConfigSchema.safeParse(config);
    // if (!result.success) {
    //   throw new Error(`Invalid configuration: ${result.error.message}`);
    // }

    // this.client = new TwitterClient(config);
    this.server = new Server({
      name: 'twitter-mcp',
      version: '1.0.0'
    }, {
      capabilities: {
        tools: {}
      }
    });

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Error handler
    this.server.onerror = (error) => {
      console.error('[MCP Error]:', error);
    };

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.error('Shutting down server...');
      await this.server.close();
      process.exit(0);
    });

    // Register tool handlers
    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // {
        //   name: 'oauth2_generate_auth_url',
        //   description: 'Generate OAuth2 authorization URL for Twitter authentication',
        //   inputSchema: {
        //     type: 'object',
        //     properties: {
        //       client_id: {
        //         type: 'string',
        //         description: 'Twitter OAuth2 client ID'
        //       },
        //       redirect_uri: {
        //         type: 'string',
        //         description: 'OAuth2 redirect URI'
        //       },
        //       scopes: {
        //         type: 'array',
        //         items: { type: 'string' },
        //         description: 'OAuth2 scopes (optional, defaults to tweet.read, tweet.write, users.read)'
        //       }
        //     },
        //     required: ['client_id', 'redirect_uri']
        //   }
        // } as Tool,
        // {
        //   name: 'oauth2_exchange_code',
        //   description: 'Exchange OAuth2 authorization code for access token',
        //   inputSchema: {
        //     type: 'object',
        //     properties: {
        //       client_id: {
        //         type: 'string',
        //         description: 'Twitter OAuth2 client ID'
        //       },
        //       client_secret: {
        //         type: 'string',
        //         description: 'Twitter OAuth2 client secret'
        //       },
        //       redirect_uri: {
        //         type: 'string',
        //         description: 'OAuth2 redirect URI (must match the one used for auth URL)'
        //       },
        //       code: {
        //         type: 'string',
        //         description: 'Authorization code received from callback'
        //       },
        //       code_verifier: {
        //         type: 'string',
        //         description: 'PKCE code verifier (from oauth2_generate_auth_url response)'
        //       }
        //     },
        //     required: ['client_id', 'client_secret', 'redirect_uri', 'code', 'code_verifier']
        //   }
        // } as Tool,
        {
          name: 'post_tweet',
          description: 'Post a new tweet to Twitter',
          inputSchema: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'The content of your tweet',
                maxLength: 280
              },
              reply_to_tweet_id: {
                type: 'string',
                description: 'Optional: ID of the tweet to reply to'
              }
            },
            required: ['text']
          }
        } as Tool
        // {
        //   name: 'search_tweets',
        //   description: 'Search for tweets on Twitter',
        //   inputSchema: {
        //     type: 'object',
        //     properties: {
        //       query: {
        //         type: 'string',
        //         description: 'Search query'
        //       },
        //       count: {
        //         type: 'number',
        //         description: 'Number of tweets to return (1-100)',
        //         minimum: 1,
        //         maximum: 100
        //       }
        //     },
        //     required: ['query', 'count']
        //   }
        // } as Tool
      ]
    }));

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const { name, arguments: args } = request.params;
      console.error(`Tool called: ${name}`, args);

      const headers = extra?.requestInfo?.headers
      console.log("Header ==>", headers)

      try {
        switch (name) {
          case 'post_tweet':
            return await this.handlePostTweet(args, headers);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        return this.handleError(error);
      }
    });
  }

  private async handleOAuth2GenerateAuthUrl(args: unknown) {
    const schema = PostTweetSchema.pick({ text: true }).extend({
      client_id: PostTweetSchema.shape.text,
      redirect_uri: PostTweetSchema.shape.text,
      scopes: PostTweetSchema.pick({ text: true }).array().optional()
    });
    
    const result = schema.safeParse(args);
    if (!result.success) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${result.error.message}`
      );
    }

    const oauth2State = OAuth2Helper.generateOAuth2State();
    const authUrl = OAuth2Helper.generateAuthUrl(
      {
        clientId: (args as any).client_id,
        clientSecret: '', // Not needed for auth URL
        redirectUri: (args as any).redirect_uri,
        scopes: (args as any).scopes
      },
      oauth2State
    );

    return {
      content: [{
        type: 'text',
        text: `OAuth2 Authorization Setup:

1. Visit this URL to authorize the application:
${authUrl}

2. After authorization, you'll be redirected to your redirect URI with a code parameter.

3. Use the following values with the oauth2_exchange_code tool:
   - Code Verifier: ${oauth2State.codeVerifier}
   - State: ${oauth2State.state}

Save the code verifier - you'll need it to exchange the authorization code for an access token.`
      }] as TextContent[]
    };
  }

  private async handleOAuth2ExchangeCode(args: unknown) {
    const schema = PostTweetSchema.pick({ text: true }).extend({
      client_id: PostTweetSchema.shape.text,
      client_secret: PostTweetSchema.shape.text,
      redirect_uri: PostTweetSchema.shape.text,
      code: PostTweetSchema.shape.text,
      code_verifier: PostTweetSchema.shape.text
    });
    
    const result = schema.safeParse(args);
    if (!result.success) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${result.error.message}`
      );
    }

    const tokenResponse = await OAuth2Helper.exchangeCodeForToken(
      {
        clientId: (args as any).client_id,
        clientSecret: (args as any).client_secret,
        redirectUri: (args as any).redirect_uri
      },
      (args as any).code,
      (args as any).code_verifier
    );

    const expiresAt = tokenResponse.expires_in ? 
      Math.floor(Date.now() / 1000) + tokenResponse.expires_in : undefined;

    return {
      content: [{
        type: 'text',
        text: `OAuth2 Token Exchange Successful!

Access Token: ${tokenResponse.access_token}
Token Type: ${tokenResponse.token_type}
${tokenResponse.refresh_token ? `Refresh Token: ${tokenResponse.refresh_token}` : ''}
${tokenResponse.expires_in ? `Expires In: ${tokenResponse.expires_in} seconds` : ''}
${expiresAt ? `Expires At: ${expiresAt} (Unix timestamp)` : ''}
${tokenResponse.scope ? `Scope: ${tokenResponse.scope}` : ''}

Environment Variables for OAuth2:
AUTH_TYPE=oauth2
CLIENT_ID=${(args as any).client_id}
CLIENT_SECRET=${(args as any).client_secret}
ACCESS_TOKEN=${tokenResponse.access_token}
${tokenResponse.refresh_token ? `REFRESH_TOKEN=${tokenResponse.refresh_token}` : ''}
${expiresAt ? `TOKEN_EXPIRES_AT=${expiresAt}` : ''}

You can now use these credentials to initialize the Twitter MCP server with OAuth2 authentication.`
      }] as TextContent[]
    };
  }

  private async handlePostTweet(args: unknown, headers?: any) {
    let client
    try {
      const clientId = headers?.twitter_client_id
      const clientSecret = headers?.twitter_client_secret
      const accessToken = headers?.twitter_access_token
      // const refreshedToken = await OAuth2Helper.refreshToken(
      //     {
      //       clientId,
      //       clientSecret,
      //       redirectUri: '' // Not needed for refresh
      //     },
      //     headers?.twitter_refresh_token
      // );
      // const accessToken = refreshedToken?.access_token

      const config: Config = {
        authType: 'oauth2',
        clientId,
        clientSecret,
        accessToken,
      }
      client = new TwitterClient(config)
    }catch (error: any) {
      throw new McpError(
          401,
          `auth failed with error: ${error.message}`
      );
    }

    const result = PostTweetSchema.safeParse(args);
    if (!result.success) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${result.error.message}`
      );
    }

    const tweet = await client.postTweet(result.data.text, result.data.reply_to_tweet_id);
    return {
      content: [{
        type: 'text',
        text: `Tweet posted successfully!\nURL: https://twitter.com/status/${tweet.id}`
      }] as TextContent[]
    };
  }

  private handleError(error: unknown) {
    if (error instanceof McpError) {
      throw error;
    }

    if (error instanceof TwitterError) {
      if (TwitterError.isRateLimit(error)) {
        return {
          content: [{
            type: 'text',
            text: 'Rate limit exceeded. Please wait a moment before trying again.',
            isError: true
          }] as TextContent[]
        };
      }

      return {
        content: [{
          type: 'text',
          text: `Twitter API error: ${(error as TwitterError).message}`,
          isError: true
        }] as TextContent[]
      };
    }

    console.error('Unexpected error:', error);
    throw new McpError(
      ErrorCode.InternalError,
      'An unexpected error occurred'
    );
  }

  async start(): Promise<void> {
    const port = parseInt(process.env.PORT || '3333');
    const options: StreamableHTTPServerTransportOptions = {
      sessionIdGenerator: undefined
    }
    const transport = new StreamableHTTPServerTransport(options);
    await this.server.connect(transport);
    
    // Create HTTP server to handle requests
    const httpServer = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/mcp') {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        req.on('end', async () => {
          try {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            
            if (req.method === 'OPTIONS') {
              res.writeHead(200);
              res.end();
              return;
            }
            
            await transport.handleRequest(req, res, JSON.parse(body));
          } catch (error) {
            console.error('HTTP request error:', error);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        });
      } else if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.writeHead(200);
        res.end();
      } else {
        res.writeHead(400);
        res.end('Not Found');
      }
    });
    
    httpServer.listen(port, () => {
      console.error(`Twitter MCP server running on HTTP port ${port}`);
    });
  }
}

// Start the server
dotenv.config();

const authType = process.env.AUTH_TYPE || 'oauth2';

let config: Config;

if (authType === 'oauth2') {
  config = {
    authType: 'oauth2',
    clientId: process.env.TWITTER_CLIENT_ID!,
    clientSecret: process.env.TWITTER_CLIENT_SECRET!,
    accessToken: process.env.TWITTER_ACCESS_TOKEN!,
    refreshToken: process.env.REFRESH_TOKEN,
    tokenExpiresAt: process.env.TOKEN_EXPIRES_AT ? parseInt(process.env.TOKEN_EXPIRES_AT) : undefined
  };
} else {
  config = {
    authType: 'legacy',
    apiKey: process.env.API_KEY!,
    apiSecretKey: process.env.API_SECRET_KEY!,
    accessToken: process.env.ACCESS_TOKEN!,
    accessTokenSecret: process.env.ACCESS_TOKEN_SECRET!
  };
}

const server = new TwitterServer(config);
server.start().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});