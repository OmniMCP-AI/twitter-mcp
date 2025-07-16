import { TwitterApi } from 'twitter-api-v2';
import { Config, TwitterError, Tweet, TwitterUser, PostedTweet, LegacyConfig, OAuth2Config } from './types.js';
import { OAuth2Helper } from './oauth2.js';

export class TwitterClient {
  private client: TwitterApi;
  private config: Config;
  private rateLimitMap = new Map<string, number>();

  constructor(config: Config) {
    this.config = config;
    this.client = this.initializeClient(config);
    console.error('Twitter API client initialized with auth type:', config.authType);
  }

  private initializeClient(config: Config): TwitterApi {
    if (config.authType === 'oauth2') {
      return new TwitterApi(config.accessToken);
    } else {
      // Legacy authentication
      const legacyConfig = config as LegacyConfig;
      return new TwitterApi({
        appKey: legacyConfig.apiKey,
        appSecret: legacyConfig.apiSecretKey,
        accessToken: legacyConfig.accessToken,
        accessSecret: legacyConfig.accessTokenSecret,
      });
    }
  }

  private async ensureValidToken(): Promise<void> {
    if (this.config.authType === 'oauth2') {
      const oauth2Config = this.config as OAuth2Config;
      
      // Check if token is expired
      if (oauth2Config.tokenExpiresAt && Date.now() >= oauth2Config.tokenExpiresAt * 1000) {
        if (oauth2Config.refreshToken) {
          try {
            console.error('Token expired, attempting refresh...');
            const refreshedToken = await OAuth2Helper.refreshToken(
              {
                clientId: oauth2Config.clientId,
                clientSecret: oauth2Config.clientSecret,
                redirectUri: '' // Not needed for refresh
              },
              oauth2Config.refreshToken
            );
            
            // Update the client with new token
            this.config = {
              ...oauth2Config,
              accessToken: refreshedToken.access_token,
              refreshToken: refreshedToken.refresh_token || oauth2Config.refreshToken,
              tokenExpiresAt: refreshedToken.expires_in ? 
                Math.floor(Date.now() / 1000) + refreshedToken.expires_in : undefined
            };
            
            this.client = new TwitterApi(refreshedToken.access_token);
            console.error('Token refreshed successfully');
          } catch (error) {
            console.error('Token refresh failed:', error);
            throw new TwitterError(
              'OAuth2 token expired and refresh failed',
              'token_expired',
              401
            );
          }
        } else {
          throw new TwitterError(
            'OAuth2 token expired and no refresh token available',
            'token_expired',
            401
          );
        }
      }
    }
  }

  async postTweet(text: string, replyToTweetId?: string): Promise<PostedTweet> {
    try {
      await this.ensureValidToken();
      const endpoint = 'tweets/create';
      await this.checkRateLimit(endpoint);

      const tweetOptions: any = { text };
      if (replyToTweetId) {
        tweetOptions.reply = { in_reply_to_tweet_id: replyToTweetId };
      }

      const response = await this.client.v2.tweet(tweetOptions);
      
      console.error(`Tweet posted successfully with ID: ${response.data.id}${replyToTweetId ? ` (reply to ${replyToTweetId})` : ''}`);
      
      return {
        id: response.data.id,
        text: response.data.text
      };
    } catch (error) {
      this.handleApiError(error);
    }
  }

  async searchTweets(query: string, count: number): Promise<{ tweets: Tweet[], users: TwitterUser[] }> {
    try {
      await this.ensureValidToken();
      const endpoint = 'tweets/search';
      await this.checkRateLimit(endpoint);

      const response = await this.client.v2.search(query, {
        max_results: count,
        expansions: ['author_id'],
        'tweet.fields': ['public_metrics', 'created_at'],
        'user.fields': ['username', 'name', 'verified']
      });

      console.error(`Fetched ${response.tweets.length} tweets for query: "${query}"`);

      const tweets = response.tweets.map(tweet => ({
        id: tweet.id,
        text: tweet.text,
        authorId: tweet.author_id ?? '',
        metrics: {
          likes: tweet.public_metrics?.like_count ?? 0,
          retweets: tweet.public_metrics?.retweet_count ?? 0,
          replies: tweet.public_metrics?.reply_count ?? 0,
          quotes: tweet.public_metrics?.quote_count ?? 0
        },
        createdAt: tweet.created_at ?? ''
      }));

      const users = response.includes.users.map(user => ({
        id: user.id,
        username: user.username,
        name: user.name,
        verified: user.verified ?? false
      }));

      return { tweets, users };
    } catch (error) {
      this.handleApiError(error);
    }
  }

  private async checkRateLimit(endpoint: string): Promise<void> {
    const lastRequest = this.rateLimitMap.get(endpoint);
    if (lastRequest) {
      const timeSinceLastRequest = Date.now() - lastRequest;
      if (timeSinceLastRequest < 1000) { // Basic rate limiting
        throw new TwitterError(
          'Rate limit exceeded',
          'rate_limit_exceeded',
          429
        );
      }
    }
    this.rateLimitMap.set(endpoint, Date.now());
  }

  private handleApiError(error: unknown): never {
    if (error instanceof TwitterError) {
      throw error;
    }

    // Handle twitter-api-v2 errors
    const apiError = error as any;
    if (apiError.code) {
      throw new TwitterError(
        apiError.message || 'Twitter API error',
        apiError.code,
        apiError.status
      );
    }

    // Handle unexpected errors
    console.error('Unexpected error in Twitter client:', error);
    throw new TwitterError(
      'An unexpected error occurred',
      'internal_error',
      500
    );
  }
}