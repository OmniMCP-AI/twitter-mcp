# OAuth2 Authentication Setup

This guide explains how to set up OAuth2 authentication for the Twitter MCP server.

## Prerequisites

1. Twitter Developer Account
2. Twitter App with OAuth2 enabled
3. Client ID and Client Secret from Twitter Developer Portal

## Setup Steps

### 1. Generate Authorization URL

Use the `oauth2_generate_auth_url` tool to create an authorization URL:

```json
{
  "client_id": "your_twitter_client_id",
  "redirect_uri": "https://your-domain.com/callback",
  "scopes": ["tweet.read", "tweet.write", "users.read"]
}
```

This will return:
- Authorization URL for the user to visit
- Code Verifier (save this!)
- State parameter

### 2. User Authorization

1. Direct the user to the authorization URL
2. User authorizes your application
3. User is redirected to your redirect URI with an authorization code

### 3. Exchange Code for Token

Use the `oauth2_exchange_code` tool with the authorization code:

```json
{
  "client_id": "your_twitter_client_id",
  "client_secret": "your_twitter_client_secret",
  "redirect_uri": "https://your-domain.com/callback",
  "code": "authorization_code_from_callback",
  "code_verifier": "code_verifier_from_step_1"
}
```

This will return:
- Access Token
- Refresh Token (if applicable)
- Token expiration time
- Environment variables for configuration

### 4. Configure Environment Variables

Set these environment variables for OAuth2 authentication:

```bash
AUTH_TYPE=oauth2
CLIENT_ID=your_twitter_client_id
CLIENT_SECRET=your_twitter_client_secret
ACCESS_TOKEN=your_access_token
REFRESH_TOKEN=your_refresh_token  # Optional
TOKEN_EXPIRES_AT=1234567890       # Optional Unix timestamp
```

### 5. Start the Server

The server will automatically use OAuth2 authentication when `AUTH_TYPE=oauth2` is set.

## Token Refresh

The server automatically handles token refresh when:
- A refresh token is available
- The access token has expired
- The token expiration time is set

## Legacy Authentication

To use the original API v1.1 authentication, either:
- Don't set `AUTH_TYPE` (defaults to legacy)
- Set `AUTH_TYPE=legacy`

Required environment variables for legacy:
```bash
AUTH_TYPE=legacy  # Optional, this is the default
API_KEY=your_api_key
API_SECRET_KEY=your_api_secret_key
ACCESS_TOKEN=your_access_token
ACCESS_TOKEN_SECRET=your_access_token_secret
```

## Error Handling

The OAuth2 implementation includes automatic error handling for:
- Expired tokens (automatic refresh if refresh token available)
- Invalid tokens
- Network errors during token operations

## Security Considerations

1. Store client secrets securely
2. Use HTTPS for redirect URIs
3. Implement proper state validation
4. Consider token storage security in production