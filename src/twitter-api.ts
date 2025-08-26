import { TwitterApi } from 'twitter-api-v2';
import { Config, TwitterError, Tweet, TwitterUser, PostedTweet, LegacyConfig, OAuth2Config } from './types.js';
import { OAuth2Helper } from './oauth2.js';
import fs from 'fs';
import path from 'path';

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

  // private async ensureValidToken(): Promise<void> {
  //   if (this.config.authType === 'oauth2') {
  //     const oauth2Config = this.config as OAuth2Config;
  //
  //     // Check if token is expired
  //     if (oauth2Config.tokenExpiresAt && Date.now() >= oauth2Config.tokenExpiresAt * 1000) {
  //       if (oauth2Config.refreshToken) {
  //         try {
  //           console.error('Token expired, attempting refresh...');
  //           const refreshedToken = await OAuth2Helper.refreshToken(
  //             {
  //               clientId: oauth2Config.clientId,
  //               clientSecret: oauth2Config.clientSecret,
  //               redirectUri: '' // Not needed for refresh
  //             },
  //             oauth2Config.refreshToken
  //           );
  //
  //           // Update the client with new token
  //           this.config = {
  //             ...oauth2Config,
  //             accessToken: refreshedToken.access_token,
  //             refreshToken: refreshedToken.refresh_token || oauth2Config.refreshToken,
  //             tokenExpiresAt: refreshedToken.expires_in ?
  //               Math.floor(Date.now() / 1000) + refreshedToken.expires_in : undefined
  //           };
  //
  //           this.client = new TwitterApi(refreshedToken.access_token);
  //           console.error('Token refreshed successfully');
  //         } catch (error) {
  //           console.error('Token refresh failed:', error);
  //           throw new TwitterError(
  //             'OAuth2 token expired and refresh failed',
  //             'token_expired',
  //             401
  //           );
  //         }
  //       } else {
  //         throw new TwitterError(
  //           'OAuth2 token expired and no refresh token available',
  //           'token_expired',
  //           401
  //         );
  //       }
  //     }
  //   }
  // }

  async postTweet(text: string, replyToTweetId?: string, mediaIds?: string[]): Promise<PostedTweet> {
    try {
      // await this.ensureValidToken();
      const endpoint = 'tweets/create';
      await this.checkRateLimit(endpoint);

      const tweetOptions: any = { text };
      if (replyToTweetId) {
        tweetOptions.reply = { in_reply_to_tweet_id: replyToTweetId };
      }

      if (mediaIds && mediaIds.length > 0) {
        tweetOptions.media = { media_ids: mediaIds };
      }

      console.log(`Posting tweet: ${tweetOptions}`);

      const response = await this.client.v2.tweet(tweetOptions);
      
      console.error(`Tweet posted successfully with ID: ${response.data.id}${replyToTweetId ? ` (reply to ${replyToTweetId})` : ''}`);
      
      return {
        id: response.data.id,
        text: response.data.text
      };
    } catch (error) {
      console.log(error);
      this.handleApiError(error);
    }
  }

  /**
   * Upload media (images and videos) to Twitter
   * @param filePaths Array of media file paths
   * @returns Array of media IDs
   */
  async uploadMedia(filePaths: string[]): Promise<string[]> {
    try {
      const endpoint = 'media/upload';
      await this.checkRateLimit(endpoint);

      const mediaIds: string[] = [];
      let imageCount = 0;
      let videoCount = 0;

      for (const filePath of filePaths) {
        try {
          // Verify file exists and is accessible
          if (!fs.existsSync(filePath)) {
            console.error(`File does not exist: ${filePath}`);
            continue;
          }

          const fileStats = fs.statSync(filePath);
          console.error(`Processing file: ${filePath}, size: ${fileStats.size} bytes`);

          // Check file size limits
          if (fileStats.size === 0) {
            console.error(`File is empty: ${filePath}`);
            continue;
          }

          if (fileStats.size > 5 * 1024 * 1024) { // 5MB limit for images
            console.error(`File too large: ${filePath} (${fileStats.size} bytes)`);
            continue;
          }

          // Detect media type
          const mediaType = this.detectMediaType(filePath);
          console.error(`Detected media type: ${mediaType} for ${filePath}`);
          
          if (mediaType === 'image') {
            // Twitter allows max 4 images
            if (imageCount >= 4) {
              console.error(`Skipping ${filePath}: Maximum 4 images allowed`);
              continue;
            }
            
            const mimeType = this.getMimeType(filePath);
            console.error(`Attempting to upload image: ${filePath}, MIME: ${mimeType}`);
            
            try {
              const mediaId = await this.client.v1.uploadMedia(filePath, {
                mimeType: mimeType
              });

              if (mediaId) {
                mediaIds.push(mediaId);
                imageCount++;
                console.error(`Successfully uploaded image: ${filePath}, Media ID: ${mediaId}, MIME: ${mimeType}`);
              }
            } catch (uploadError: any) {
              console.error(`Failed to upload image ${filePath}:`, {
                error: uploadError.message,
                code: uploadError.code,
                status: uploadError.status,
                details: uploadError.data
              });
              
              // Check for specific error types
              if (uploadError.code === 'INVALID_MEDIA') {
                console.error(`Invalid media format for ${filePath}`);
              } else if (uploadError.code === 'MEDIA_TOO_LARGE') {
                console.error(`Media file too large: ${filePath}`);
              } else if (uploadError.code === 'RATE_LIMIT_EXCEEDED') {
                console.error(`Rate limit exceeded for media upload`);
                break; // Stop processing more files
              }
              
              continue;
            }
          } else if (mediaType === 'video') {
            // Twitter allows only 1 video per tweet
            if (videoCount >= 1) {
              console.error(`Skipping ${filePath}: Only 1 video allowed per tweet`);
              continue;
            }
            
            const mimeType = this.getVideoMimeType(filePath);
            console.error(`Attempting to upload video: ${filePath}, MIME: ${mimeType}`);
            
            try {
              const mediaId = await this.client.v1.uploadMedia(filePath, {
                mimeType: mimeType
              });

              if (mediaId) {
                mediaIds.push(mediaId);
                videoCount++;
                console.error(`Successfully uploaded video: ${filePath}, Media ID: ${mediaId}, MIME: ${mimeType}`);
              }
            } catch (uploadError: any) {
              console.error(`Failed to upload video ${filePath}:`, {
                error: uploadError.message,
                code: uploadError.code,
                status: uploadError.status,
                details: uploadError.data
              });
              continue;
            }
          } else {
            console.error(`Unsupported media type for ${filePath}`);
            continue;
          }
        } catch (error) {
          console.error(`Error processing media ${filePath}:`, error);
          continue;
        }
      }

      console.error(`Media upload completed. Total media IDs: ${mediaIds.length}`);
      return mediaIds;
    } catch (error) {
      console.error('Error in uploadMedia method:', error);
      this.handleApiError(error);
    }
  }

  /**
   * Dynamically detect MIME type based on file extension and content
   * @param filePath Path to the file
   * @returns MIME type string
   */
  private getMimeType(filePath: string): string {
    try {
      // Get file extension
      const ext = path.extname(filePath).toLowerCase();
      
      // Extension to MIME type mapping
      const mimeTypeMap: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.tiff': 'image/tiff',
        '.svg': 'image/svg+xml'
      };

      // Check if we have a known extension
      if (mimeTypeMap[ext]) {
        return mimeTypeMap[ext];
      }

      // If no known extension, try to detect from file header (magic bytes)
      return this.detectMimeTypeFromContent(filePath);
    } catch (error) {
      console.error(`Error detecting MIME type for ${filePath}:`, error);
      // Fallback to jpeg as default
      return 'image/jpeg';
    }
  }

  /**
   * Detect MIME type from file content using magic bytes
   * @param filePath Path to the file
   * @returns MIME type string
   */
  private detectMimeTypeFromContent(filePath: string): string {
    try {
      // Read first few bytes to detect file type
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(12);
      fs.readSync(fd, buffer, 0, 12, 0);
      fs.closeSync(fd);

      // Magic bytes for different image formats
      if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return 'image/jpeg';
      }
      
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        return 'image/png';
      }
      
      if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
        return 'image/gif';
      }
      
      if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        return 'image/webp';
      }
      
      if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
        return 'image/bmp';
      }
      
      if ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2A && buffer[3] === 0x00) ||
          (buffer[0] === 0x4D && buffer[1] === 0x4D && buffer[2] === 0x00 && buffer[3] === 0x2A)) {
        return 'image/tiff';
      }

      // Default fallback
      return 'image/jpeg';
    } catch (error) {
      console.error(`Error reading file content for MIME detection: ${filePath}`, error);
      return 'image/jpeg';
    }
  }

  /**
   * Detect if file is image or video based on extension and content
   * @param filePath Path to the file
   * @returns 'image', 'video', or 'unknown'
   */
  private detectMediaType(filePath: string): 'image' | 'video' | 'unknown' {
    try {
      const ext = path.extname(filePath).toLowerCase();
      
      // Image extensions
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg'];
      if (imageExtensions.includes(ext)) {
        return 'image';
      }
      
      // Video extensions
      const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.3gp'];
      if (videoExtensions.includes(ext)) {
        return 'video';
      }
      
      // If no extension, try content detection
      return this.detectMediaTypeFromContent(filePath);
    } catch (error) {
      console.error(`Error detecting media type for ${filePath}:`, error);
      return 'unknown';
    }
  }

  /**
   * Detect media type from file content using magic bytes
   * @param filePath Path to the file
   * @returns 'image', 'video', or 'unknown'
   */
  private detectMediaTypeFromContent(filePath: string): 'image' | 'video' | 'unknown' {
    try {
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(16);
      fs.readSync(fd, buffer, 0, 16, 0);
      fs.closeSync(fd);

      // Video magic bytes
      if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
        // MP4, MOV, M4V, 3GP
        return 'video';
      }
      
      if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
        // AVI, WMV
        return 'video';
      }
      
      if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) {
        // MKV
        return 'video';
      }
      
      if (buffer[0] === 0x46 && buffer[1] === 0x4C && buffer[2] === 0x56 && buffer[3] === 0x01) {
        // FLV
        return 'video';
      }
      
      if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
          buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x4D) {
        // WebM
        return 'video';
      }

      // Image magic bytes (already handled in detectMimeTypeFromContent)
      if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return 'image';
      }
      
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        return 'image';
      }
      
      if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
        return 'image';
      }

      return 'unknown';
    } catch (error) {
      console.error(`Error reading file content for media type detection: ${filePath}`, error);
      return 'unknown';
    }
  }

  /**
   * Get MIME type for video files
   * @param filePath Path to the video file
   * @returns MIME type string
   */
  private getVideoMimeType(filePath: string): string {
    try {
      const ext = path.extname(filePath).toLowerCase();
      
      // Extension to MIME type mapping for videos
      const videoMimeTypeMap: Record<string, string> = {
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.mkv': 'video/x-matroska',
        '.wmv': 'video/x-ms-wmv',
        '.flv': 'video/x-flv',
        '.webm': 'video/webm',
        '.m4v': 'video/x-m4v',
        '.3gp': 'video/3gpp'
      };

      if (videoMimeTypeMap[ext]) {
        return videoMimeTypeMap[ext];
      }

      // Default fallback
      return 'video/mp4';
    } catch (error) {
      console.error(`Error detecting video MIME type for ${filePath}:`, error);
      return 'video/mp4';
    }
  }

  /**
   * Upload video with chunking and resume capability
   * @param filePath Path to the video file
   * @param mimeType MIME type of the video
   * @returns Media ID string
   */
  private async uploadVideoWithChunking(filePath: string, mimeType: string): Promise<string | null> {
    try {
      const stats = fs.statSync(filePath);
      const fileSize = stats.size;
      
      // Twitter video limits: max 512MB, max 2 minutes 20 seconds
      const MAX_FILE_SIZE = 512 * 1024 * 1024; // 512MB
      
      if (fileSize > MAX_FILE_SIZE) {
        throw new Error(`Video file too large: ${fileSize} bytes. Maximum allowed: ${MAX_FILE_SIZE} bytes`);
      }

      console.error(`Starting video upload: ${filePath} (${fileSize} bytes)`);
      
      // For now, use the standard uploadMedia method
      // TODO: Implement proper chunked upload when Twitter API supports it
      try {
        const mediaId = await this.client.v1.uploadMedia(filePath, {
          mimeType: mimeType
        });

        if (mediaId) {
          console.error(`Video upload completed successfully: ${mediaId}`);
          return mediaId;
        }
      } catch (uploadError) {
        console.error(`Error uploading video: ${filePath}`, uploadError);
        
        // If it's a large file error, provide guidance
        if (fileSize > 100 * 1024 * 1024) { // 100MB
          console.error(`Large video file detected. Consider using Twitter's web interface for files over 100MB.`);
        }
        
        return null;
      }
      
      return null;
      
    } catch (error) {
      console.error(`Error in video upload: ${filePath}`, error);
      return null;
    }
  }



  async searchTweets(query: string, count: number): Promise<{ tweets: Tweet[], users: TwitterUser[] }> {
    try {
      // await this.ensureValidToken();
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
    
    // Log detailed error information
    console.error('Twitter API Error Details:', {
      message: apiError.message,
      code: apiError.code,
      status: apiError.status,
      data: apiError.data,
      stack: apiError.stack
    });

    if (apiError.code) {
      // Handle specific error codes
      let errorMessage = apiError.message || 'Twitter API error';
      let errorCode = apiError.code;
      
      switch (apiError.code) {
        case 'INVALID_MEDIA':
          errorMessage = 'Invalid media format or corrupted file';
          break;
        case 'MEDIA_TOO_LARGE':
          errorMessage = 'Media file exceeds size limit';
          break;
        case 'RATE_LIMIT_EXCEEDED':
          errorMessage = 'Rate limit exceeded, please wait before retrying';
          break;
        case 'UNAUTHORIZED':
          errorMessage = 'Authentication failed, please check your credentials';
          break;
        case 'FORBIDDEN':
          errorMessage = 'Access denied, insufficient permissions';
          break;
        case 'NOT_FOUND':
          errorMessage = 'Resource not found';
          break;
        case 'REQUEST_TIMEOUT':
          errorMessage = 'Request timeout, please try again';
          break;
        case 'NETWORK_ERROR':
          errorMessage = 'Network connection error, please check your internet connection';
          break;
        default:
          if (apiError.status === 429) {
            errorMessage = 'Rate limit exceeded, please wait before retrying';
            errorCode = 'rate_limit_exceeded';
          } else if (apiError.status >= 500) {
            errorMessage = 'Twitter service temporarily unavailable, please try again later';
            errorCode = 'service_unavailable';
          }
      }
      
      throw new TwitterError(
        errorMessage,
        errorCode,
        apiError.status
      );
    }

    // Handle unexpected errors
    console.error('Unexpected error in Twitter client:', error);
    throw new TwitterError(
      'An unexpected error occurred while communicating with Twitter API',
      'internal_error',
      500
    );
  }
}