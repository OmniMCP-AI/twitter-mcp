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
import { EUploadMimeType } from 'twitter-api-v2';
import { TwitterClient } from './twitter-api.js';
import { ResponseFormatter } from './formatter.js';
import { OAuth2Helper } from './oauth2.js';
import {
  Config, ConfigSchema,
  PostTweetSchema, SearchTweetsSchema,
  PostTweetThreadSchema,
  TwitterError
} from './types.js';
import dotenv from 'dotenv';
import {randomUUID} from "node:crypto";

// Token cache structure
interface TokenCacheEntry {
  access_token: string;
  expires_at: number; // Timestamp when the token expires
  refresh_token?: string;
}

const tokenCache: Record<string, TokenCacheEntry> = {};

const ONE_HOUR_MS = 60 * 60;



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
              },
              images: {
                type: 'array',
                 description: 'Optional: This parameter is an array, and its elements can be either base64-encoded images or HTTP links.etc: ["https://pic.com/a.jpg"]',
                items: {
                  type: 'string',
                  description: 'Optional: The base64 encoded image or http url'
                }
              },
              videos: {
                type: 'array',
                description: 'Optional: This parameter is an array, and its elements can be either base64-encoded videos or HTTP links.etc: ["https://video.com/a.mp4"]',
                items: {
                  type: 'string',
                  description: 'Optional: The base64 encoded video or http url'
                }
              }
            },
            required: ['text']
          }
        } as Tool,
        {
          name: 'post_tweet_thread',
          description: 'Publish multiple related tweets on Twitter at once, forming an organized tweet thread',
          inputSchema: {
            type: 'object',
            properties: {
              tweets: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    text: {
                      type: 'string',
                      description: 'The content of your tweet',
                      maxLength: 280
                    },
                    images: {
                      type: 'array',
                      description: 'Optional: This parameter is an array, and its elements can be either base64-encoded images or HTTP links.etc: ["https://pic.com/a.jpg"]',
                      items: {
                        type: 'string',
                        description: 'Optional: The base64 encoded image or http url'
                      },
                      optional: true
                    },
                    videos: {
                      type: 'array',
                      description: 'Optional: This parameter is an array, and its elements can be either base64-encoded videos or HTTP links.etc: ["https://video.com/a.mp4"]',
                      items: {
                        type: 'string',
                        description: 'Optional: The base64 encoded video or http url'
                      },
                      optional: true
                    }
                  }
                }
              }
            },
            required: ['tweets']
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
          case 'post_tweet_thread':
            return await this.handlePostTweetThread(args, headers);
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

  private async handlePostTweetThread(args: unknown, headers?: any) {
    const result = PostTweetThreadSchema.safeParse(args);
    if (!result.success) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${result.error.message}`
      );
    }
    const tweetIds: string[] = []
    let tweetId = ''
    for (const tweet of result.data.tweets) {
      const tweetResult = PostTweetSchema.safeParse(tweet);
      if (!tweetResult.success) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid parameters: ${tweetResult.error.message}`
        );
      }
      if (tweetId && tweetId.length > 0) {
        tweetResult.data.reply_to_tweet_id = tweetId
      }
      tweetId = await this.handleOncePostTweet(tweetResult.data, headers)
      tweetIds.push(tweetId)
    }

    console.log("Tweet posted successfully!********", tweetId)

    const userClient = await this.getUserClient(args, headers)
    const user = await userClient.getCurrentUser()
    

    const urls = tweetIds.map(id => `https://twitter.com/${user.username}/status/${id}`)
    return {
      content: [{
        type: 'text',
        text: `Tweet thread posted successfully!\nURL: ${urls.join('\n')}`
      }] as TextContent[]
    };
  }

  private async handlePostTweet(args: unknown, headers?: any) {
    const tweetId = await this.handleOncePostTweet(args, headers)
    const client = await this.getUserClient(args, headers)
    const user = await client.getCurrentUser()
    
    const url = `https://twitter.com/${user.username}/status/${tweetId}`
    return {
      content: [{
        type: 'text',
        text: `Tweet posted successfully!\nURL: ${url}`
      }] as TextContent[]
    };
  }

  private async getUserClient(args: unknown, headers?: any) {
    let client
    try {
      const clientId = headers?.twitter_client_id
      const clientSecret = headers?.twitter_client_secret
      const refreshToken = headers?.twitter_refresh_token
      const userId = headers?.user_id
      const serverId = headers?.server_id
      const updateConfigUrl = headers?.update_config_url

      let accessToken = headers?.access_token

      const cacheKey = `${userId}:${serverId}`;

      const cachedToken = tokenCache[cacheKey];

      const now = Date.now();


      if (cachedToken && cachedToken.expires_at > now) {
        accessToken = cachedToken.access_token;
      }else {
        const refreshedToken = await OAuth2Helper.refreshToken(
            {
              clientId,
              clientSecret,
              redirectUri: '' // Not needed for refresh
            },
            refreshToken,
            userId,
            serverId,
            updateConfigUrl
        );
        accessToken = refreshedToken?.access_token
        tokenCache[cacheKey] = {
          access_token: refreshedToken?.access_token,
          expires_at: now + (refreshedToken?.expires_in || ONE_HOUR_MS) * 1000,
          refresh_token: refreshedToken?.refresh_token,
        };
      }


      // const accessToken = headers?.twitter_access_token


      const config: Config = {
        authType: 'oauth2',
        clientId,
        clientSecret,
        accessToken
      }
      client = new TwitterClient(config)
      return client
    }catch (error: any) {
      throw new McpError(
          401,
          `auth failed with error: ${error.message}`
      );
    }
  }

  private async handleOncePostTweet(args: unknown, headers?: any) {
    
    const client = await this.getUserClient(args, headers)

    const result = PostTweetSchema.safeParse(args);
    if (!result.success) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${result.error.message}`
      );
    }

    const mediaIds = await this.handleUploadMedia(client, result.data.images, result.data.videos)

    if (((result.data.images && result.data.images.length > 0) || (result.data.videos && result.data.videos.length > 0)) && mediaIds.length == 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: Invalid media`
      );
    }

    let tweetId = '';
    try {
      const tweet = await client.postTweet(result.data.text, result.data.reply_to_tweet_id, mediaIds);
      tweetId = tweet.id;
      console.log("Tweet posted successfully!********")
    } catch (error) {
      console.log("ERROR********", error)
    }

    return tweetId
  }

  private async handleUploadMedia (client: TwitterClient, images?: string[], videos?: string[]) {
    const mediaIds: string[] = [];
    
    try {
      // 处理图片上传
      if (images && images.length > 0) {
        // Twitter 最多允许4张图片
        for (let image of images.slice(0, 4)) {
          try {
            const mediaId = await this.uploadMedia(client, image, 'image');
            if (mediaId) {
              mediaIds.push(mediaId);
            }
          } catch (error) {
            console.error('图片上传失败:', error);
            continue; // 继续处理下一张图片
          }
        }
      }
      
      // 处理视频上传
      if (videos && videos.length > 0) {
        // Twitter 最多允许1个视频
        for (const video of videos.slice(0, 1)) {
          try {
            const mediaId = await this.uploadMedia(client, video, 'video');
            if (mediaId) {
              mediaIds.push(mediaId);
            }
          } catch (error) {
            console.error('视频上传失败:', error);
            continue; // 继续处理下一个视频
          }
        }
      }
      
      return mediaIds;
    } catch (error) {
      console.error('媒体上传过程中发生错误:', error);
      return mediaIds; // 返回已成功上传的媒体ID
    }
  }

  private async uploadMedia (client: TwitterClient, media: string, type: 'image' | 'video') {
    try {
      let extractedMimeType = ''
      let imageBuffer = null
      if (media.startsWith('http')) {
        const response = await fetch(media)
        const buffer = await response.arrayBuffer()
        imageBuffer = Buffer.from(buffer)
        extractedMimeType = response.headers.get('content-type') || (type == 'image' ? 'image/jpeg' : 'video/mp4')
      } else {
        const match = type == 'image' ?  media.match(/^data:(image\/\w+);base64,(.+)$/) : media.match(/^data:(video\/\w+);base64,(.+)$/)
        if (!match) throw new Error('Invalid Media')
    
        extractedMimeType = match[1]
        const base64Data = match[2]
        imageBuffer = Buffer.from(base64Data, 'base64')
      }

      if (!imageBuffer) {
        throw new Error('Invalid Media')
      }

      const mediaId = await client.uploadMedia(imageBuffer, extractedMimeType as EUploadMimeType)
      return mediaId;
    } catch (error: any) {
      console.error('上传 Twitter Media 失败:', error)
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.message}`
      );
    }
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