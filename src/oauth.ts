// ---------------------------------------------------------------------------
// OpenBrowserClaw — OAuth PKCE flow for Anthropic Console
// ---------------------------------------------------------------------------
//
// Implements the same OAuth 2.0 + PKCE flow used by Claude Code CLI to
// authenticate via the Anthropic Console and create a permanent API key.
//
// Flow:
// 1. Generate PKCE challenge/verifier
// 2. Open console.anthropic.com/oauth/authorize
// 3. User authenticates and gets an authorization code
// 4. Exchange code for access token
// 5. Use access token to create a permanent API key
//
// References:
// - https://github.com/anomalyco/opencode-anthropic-auth
// - https://github.com/querymt/anthropic-auth

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
const TOKEN_ENDPOINT = 'https://console.anthropic.com/v1/oauth/token';
const CREATE_KEY_ENDPOINT = 'https://api.anthropic.com/api/oauth/claude_cli/create_api_key';

// ---------------------------------------------------------------------------
// PKCE helpers (using Web Crypto API — works in any modern browser)
// ---------------------------------------------------------------------------

function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest('SHA-256', encoder.encode(plain));
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface PKCEPair {
  verifier: string;
  challenge: string;
}

export async function generatePKCE(): Promise<PKCEPair> {
  const verifier = generateRandomString(32); // 64-char hex string
  const hash = await sha256(verifier);
  const challenge = base64UrlEncode(hash);
  return { verifier, challenge };
}

// ---------------------------------------------------------------------------
// OAuth authorization URL
// ---------------------------------------------------------------------------

export function buildAuthorizationUrl(challenge: string): string {
  const url = new URL('https://console.anthropic.com/oauth/authorize');
  url.searchParams.set('code', 'true');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', 'org:create_api_key user:profile user:inference');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export interface TokenResult {
  type: 'success';
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface TokenFailure {
  type: 'failed';
  error: string;
}

export async function exchangeCodeForToken(
  code: string,
  verifier: string,
): Promise<TokenResult | TokenFailure> {
  // Anthropic returns the code in "code#state" format
  const parts = code.split('#');
  const authCode = parts[0];

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: authCode,
      state: parts[1] || '',
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { type: 'failed', error: `Token exchange failed (${res.status}): ${body}` };
  }

  const json = await res.json();
  return {
    type: 'success',
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

// ---------------------------------------------------------------------------
// API key creation
// ---------------------------------------------------------------------------

export interface ApiKeyResult {
  type: 'success';
  apiKey: string;
}

export interface ApiKeyFailure {
  type: 'failed';
  error: string;
}

export async function createApiKey(
  accessToken: string,
): Promise<ApiKeyResult | ApiKeyFailure> {
  const res = await fetch(CREATE_KEY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { type: 'failed', error: `API key creation failed (${res.status}): ${body}` };
  }

  const json = await res.json();
  if (!json.raw_key) {
    return { type: 'failed', error: 'Response did not contain an API key' };
  }

  return { type: 'success', apiKey: json.raw_key };
}

// ---------------------------------------------------------------------------
// Full flow helper — combines all steps after the user gets the auth code
// ---------------------------------------------------------------------------

export async function completeOAuthFlow(
  code: string,
  verifier: string,
): Promise<ApiKeyResult | ApiKeyFailure> {
  const tokenResult = await exchangeCodeForToken(code, verifier);
  if (tokenResult.type === 'failed') {
    return tokenResult;
  }

  return createApiKey(tokenResult.accessToken);
}
