import { z } from 'zod';

// Legacy API v1.1 authentication schema
export const LegacyConfigSchema = z.object({
    apiKey: z.string().min(1, 'API Key is required'),
    apiSecretKey: z.string().min(1, 'API Secret Key is required'),
    accessToken: z.string().min(1, 'Access Token is required'),
    accessTokenSecret: z.string().min(1, 'Access Token Secret is required'),
    authType: z.literal('legacy').default('legacy')
});

// OAuth2 authentication schema
export const OAuth2ConfigSchema = z.object({
    clientId: z.string().min(1, 'Client ID is required'),
    clientSecret: z.string().min(1, 'Client Secret is required'),
    accessToken: z.string().min(1, 'Access Token is required'),
    refreshToken: z.string().optional(),
    authType: z.literal('oauth2'),
    tokenExpiresAt: z.number().optional() // Unix timestamp
});

// Unified configuration schema
export const ConfigSchema = z.discriminatedUnion('authType', [
    LegacyConfigSchema,
    OAuth2ConfigSchema
]);

export type LegacyConfig = z.infer<typeof LegacyConfigSchema>;
export type OAuth2Config = z.infer<typeof OAuth2ConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

// Tool input schemas
export const PostTweetSchema = z.object({
    text: z.string()
        .min(1, 'Tweet text cannot be empty')
        .max(280, 'Tweet cannot exceed 280 characters'),
    reply_to_tweet_id: z.string().optional(),
    images: z.array(z.string()).optional(),
    videos: z.array(z.string()).optional()
});

export const PostTweetThreadSchema = z.object({
    tweets: z.array(PostTweetSchema)
});

export const SearchTweetsSchema = z.object({
    query: z.string().min(1, 'Search query cannot be empty'),
    count: z.number()
        .int('Count must be an integer')
        .min(10, 'Minimum count is 10')
        .max(100, 'Maximum count is 100')
});

export type PostTweetArgs = z.infer<typeof PostTweetSchema>;
export type SearchTweetsArgs = z.infer<typeof SearchTweetsSchema>;

// API Response types
export interface TweetMetrics {
    likes: number;
    retweets: number;
}

export interface PostedTweet {
    id: string;
    text: string;
}

export interface Tweet {
    id: string;
    text: string;
    authorId: string;
    metrics: TweetMetrics;
    createdAt: string;
}

export interface TwitterUser {
    id: string;
    username: string;
}

// Error types
export class TwitterError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly status?: number
    ) {
        super(message);
        this.name = 'TwitterError';
    }

    static isRateLimit(error: unknown): error is TwitterError {
        return error instanceof TwitterError && error.code === 'rate_limit_exceeded';
    }
}

// Response formatter types
export interface FormattedTweet {
    position: number;
    author: {
        username: string;
    };
    content: string;
    metrics: TweetMetrics;
    url: string;
}

export interface SearchResponse {
    query: string;
    count: number;
    tweets: FormattedTweet[];
}