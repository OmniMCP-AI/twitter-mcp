import { createHash, randomBytes } from 'crypto';
import axios from 'axios';


export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
}

export interface OAuth2TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

export interface OAuth2State {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

async function update_config_prod(userId: string, serverId: string, refreshToken: string, updateConfigUrl: string){
  try {
    console.error('[Config Update Debug] Starting config update...');
    console.error('[Config Update Debug] Parameters:', {
      userId,
      serverId,
      refreshToken: refreshToken ? '***MASKED***' : 'NOT_PROVIDED',
      updateConfigUrl
    });

    const requestBody = {
      user_id: userId,
      mcp_server_id: serverId,
      config:{
        'TWITTER_REFRESH_TOKEN': refreshToken,
      },
      scope: 'private',
    };

    console.error('[Config Update Debug] Request body:', {
      ...requestBody,
      config: {
        'TWITTER_REFRESH_TOKEN': requestBody.config.TWITTER_REFRESH_TOKEN ? '***MASKED***' : 'NOT_PROVIDED'
      }
    });

    const response = await axios.post(updateConfigUrl, requestBody);
    console.error('[Config Update Debug] Response status:', response.status);
    console.error('[Config Update Debug] Response data:', response?.data);
  } catch (error: any) {
    console.error('[Config Update Debug] Error updating user config:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data
    });
    throw new Error(`Error update user config: ${error.message}`);
  }
}

export class OAuth2Helper {
  private static readonly TWITTER_AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
  private static readonly TWITTER_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';

  /**
   * Generate OAuth2 state and PKCE parameters
   */
  static generateOAuth2State(): OAuth2State {
    const state = randomBytes(32).toString('hex');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

    return {
      state,
      codeVerifier,
      codeChallenge
    };
  }

  /**
   * Generate authorization URL for OAuth2 flow
   */
  static generateAuthUrl(config: OAuth2Config, oauth2State: OAuth2State): string {
    const defaultScopes = ['tweet.read', 'tweet.write', 'users.read'];
    const scopes = config.scopes || defaultScopes;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: scopes.join(' '),
      state: oauth2State.state,
      code_challenge: oauth2State.codeChallenge,
      code_challenge_method: 'S256'
    });

    return `${this.TWITTER_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  static async exchangeCodeForToken(
      config: OAuth2Config,
      code: string,
      codeVerifier: string
  ): Promise<OAuth2TokenResponse> {
    const response = await fetch(this.TWITTER_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: config.redirectUri,
        code_verifier: codeVerifier
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OAuth2 token exchange failed: ${error.error_description || error.error}`);
    }

    return await response.json();
  }

  /**
   * Refresh access token using refresh token
   */
  static async refreshToken(
      config: OAuth2Config,
      refreshToken: string,
      userId: string,
      serverId: string,
      updateConfigUrl: string
  ): Promise<OAuth2TokenResponse> {
    console.error('[OAuth2 Debug] Starting token refresh...');
    console.error('[OAuth2 Debug] Config:', {
      clientId: config.clientId,
      clientSecret: config.clientSecret ? '***MASKED***' : 'NOT_PROVIDED',
      refreshToken: refreshToken ? '***MASKED***' : 'NOT_PROVIDED',
      userId,
      serverId,
      updateConfigUrl
    });

    const authHeader = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
    console.error('[OAuth2 Debug] Auth header created:', authHeader.substring(0, 20) + '...');

    const requestBody = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    });
    console.error('[OAuth2 Debug] Request body:', requestBody.toString().replace(refreshToken, '***MASKED***'));

    console.error('[OAuth2 Debug] Making request to:', this.TWITTER_TOKEN_URL);

    let response;
    try {
      response = await fetch(this.TWITTER_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': authHeader
        },
        body: requestBody
      });
    } catch (fetchError: any) {
      console.error('[OAuth2 Debug] Network error during fetch:', {
        message: fetchError.message,
        code: fetchError.code,
        errno: fetchError.errno,
        stack: fetchError.stack
      });

      // Provide a more helpful error message
      if (fetchError.message.includes('fetch failed') || fetchError.code === 'ENOTFOUND' || fetchError.code === 'ECONNREFUSED') {
        throw new Error(`Network connectivity issue: Cannot reach Twitter API at ${this.TWITTER_TOKEN_URL}. This could be due to:\n` +
            '1. Firewall or proxy blocking access to api.twitter.com\n' +
            '2. Network connectivity issues\n' +
            '3. Corporate network restrictions\n' +
            '4. DNS resolution problems\n' +
            `Original error: ${fetchError.message}`);
      } else {
        throw new Error(`OAuth2 token refresh network error: ${fetchError.message}`);
      }
    }

    console.error('[OAuth2 Debug] Response status:', response.status);
    console.error('[OAuth2 Debug] Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OAuth2 Debug] Error response body:', errorText);

      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { error: 'parse_error', error_description: errorText };
      }

      console.error('[OAuth2 Debug] Parsed error:', error);
      throw new Error(`OAuth2 token refresh failed: ${error.error_description || error.error} (Status: ${response.status})`);
    }

    const result = await response.json();
    console.error('[OAuth2 Debug] Success response:', {
      ...result,
      access_token: result.access_token ? '***MASKED***' : 'NOT_PROVIDED',
      refresh_token: result.refresh_token ? '***MASKED***' : 'NOT_PROVIDED'
    });



    const dev_url = process.env.DEV_OMNIMCP_BE_URL || '';
    const prod_url = process.env.PROD_OMNIMCP_BE_URL || '';

    let extraUpdateConfig = updateConfigUrl
    if (extraUpdateConfig.includes("omnimcp-be-dev")){

      extraUpdateConfig = extraUpdateConfig.replace("omnimcp-be-dev", "omnimcp-be");
    }else {
      extraUpdateConfig = extraUpdateConfig.replace("omnimcp-be", "omnimcp-be-dev");
    }

    // Update config only if we have the required parameters
    if (userId && serverId && updateConfigUrl && result.refresh_token) {
      console.error('[OAuth2 Debug] Updating config with new refresh token...');
      console.error('[OAuth2 Debug] Update URLs:', { updateConfigUrl, extraUpdateConfig });


      try {
        await Promise.all([
          update_config_prod(userId, serverId, result.refresh_token, updateConfigUrl),
          update_config_prod(userId, serverId, result.refresh_token, extraUpdateConfig)
        ]);
        console.error('[OAuth2 Debug] Config updated successfully');
      } catch (configError: any) {
        console.error('[OAuth2 Debug] Warning: Failed to update config:', configError.message);
        // Don't fail the token refresh if config update fails
      }
    } else {
      console.error('[OAuth2 Debug] Skipping config update - missing required parameters:', {
        hasUserId: !!userId,
        hasServerId: !!serverId,
        hasUpdateConfigUrl: !!updateConfigUrl,
        hasRefreshToken: !!result.refresh_token
      });
    }


    console.error('[OAuth2 Debug] Token refresh completed successfully');
    return result
  }

  /**
   * Revoke access token
   */
  static async revokeToken(config: OAuth2Config, token: string): Promise<void> {
    const response = await fetch('https://api.twitter.com/2/oauth2/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`
      },
      body: new URLSearchParams({
        token: token,
        token_type_hint: 'access_token'
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OAuth2 token revocation failed: ${error.error_description || error.error}`);
    }
  }
}