import { createHash, randomBytes } from 'crypto';
import axios from 'axios';
import { logger } from './logger.js';

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
    const response = await axios.post(updateConfigUrl, {
      user_id: userId,
      mcp_server_id: serverId,
      config:{
        'TWITTER_REFRESH_TOKEN': refreshToken,
      },
      scope: 'private',
    });
    console.error(response?.data);
  } catch (error) {
    console.error('Error update user config:', error);
    throw new Error('Error update user config');
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
    const response = await fetch(this.TWITTER_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      })
    });

    if (!response.ok) {
      const error = await response.json();
      logger.error(`${userId} OAuth2 token refresh failed: ${error.error_description || error.error}`);
      throw new Error(`OAuth2 token refresh failed: ${error.error_description || error.error}`);
    }

    const result = await response.json();

    console.error('Refresh token:', result);

    let extraUpdateConfig = updateConfigUrl
    if (extraUpdateConfig.includes("omnimcp-be-dev")){
      extraUpdateConfig = extraUpdateConfig.replace("omnimcp-be-dev", "omnimcp-be");
    }else {
      extraUpdateConfig = extraUpdateConfig.replace("omnimcp-be", "omnimcp-be-dev");
    }


    const dev_url = process.env.DEV_OMNIMCP_BE_URL || '';
    const prod_url = process.env.PROD_OMNIMCP_BE_URL || '';

    try {
      await Promise.all([
        update_config_prod(userId, serverId, result.refresh_token, dev_url || updateConfigUrl),
        update_config_prod(userId, serverId, result.refresh_token, prod_url || extraUpdateConfig)
      ]);
      console.error('[OAuth2 Debug] Config updated successfully');
      logger.error(`${userId} OAuth2 token refresh success`);
    } catch (configError: any) {
      console.error('[OAuth2 Debug] Warning: Failed to update config:', configError.message);
      logger.error(`${userId} OAuth2 token refresh failed: ${configError.message}`);
    }

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