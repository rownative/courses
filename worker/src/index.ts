/**
 * rownative Cloudflare Worker
 *
 * OAuth (intervals.icu), session management, liked courses, KML serving.
 *
 * iOS-compatible state handling:
 *   OAuth state is a HMAC-signed nonce embedded in the state parameter itself.
 *   No cookie is needed to store the state, which avoids iOS Safari's
 *   cross-site cookie restrictions (ITP) that cause "invalid state" errors
 *   when the OAuth provider redirects back to the callback URL.
 *
 * Session:
 *   An AES-GCM encrypted JWT-like cookie (`rn_session`) stores the athlete ID
 *   and the intervals.icu access/refresh tokens after successful login.
 */

export interface Env {
  KV: KVNamespace;
  INTERVALS_CLIENT_ID: string;
  INTERVALS_CLIENT_SECRET: string;
  /** 32 bytes hex-encoded.  Used for HMAC state signing AND AES-GCM session encryption. */
  TOKEN_ENCRYPTION_KEY: string;
  INTERVALS_AUTHORIZE_URL: string;
  INTERVALS_TOKEN_URL: string;
  INTERVALS_API_BASE: string;
  REDIRECT_URI: string;
  SITE_BASE: string;
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

/** Import the shared key as an HMAC-SHA-256 key. */
async function importHmacKey(hexKey: string): Promise<CryptoKey> {
  const raw = hexToBytes(hexKey);
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Import the shared key as an AES-GCM key (uses first 32 bytes). */
async function importAesKey(hexKey: string): Promise<CryptoKey> {
  const raw = hexToBytes(hexKey).slice(0, 32);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

function bytesToBase64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function base64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// ---------------------------------------------------------------------------
// State helpers (iOS-compatible, stateless — no cookie required)
// ---------------------------------------------------------------------------

/**
 * Generate an HMAC-signed state token.
 *
 * Format: `<nonce>.<base64url(HMAC-SHA256(nonce))>`
 *
 * Because the signature is computed over the nonce using the server secret,
 * no server-side storage (cookie or KV) is needed.  This avoids the iOS
 * Safari ITP problem where cross-site cookies are blocked during the OAuth
 * redirect, causing state validation to fail with "invalid state".
 */
async function generateState(env: Env): Promise<string> {
  const nonce = bytesToBase64url(crypto.getRandomValues(new Uint8Array(24)).buffer as ArrayBuffer);
  const key = await importHmacKey(env.TOKEN_ENCRYPTION_KEY);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(nonce));
  return `${nonce}.${bytesToBase64url(sig)}`;
}

/**
 * Validate a state token returned by the OAuth provider.
 *
 * Returns true only if the HMAC signature is valid.
 */
async function validateState(state: string, env: Env): Promise<boolean> {
  const dot = state.lastIndexOf(".");
  if (dot < 1) return false;
  const nonce = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  let sigBytes: Uint8Array;
  try {
    sigBytes = base64urlToBytes(sig);
  } catch {
    return false;
  }
  const key = await importHmacKey(env.TOKEN_ENCRYPTION_KEY);
  return crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(nonce));
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

interface SessionData {
  athleteId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp (seconds)
}

const SESSION_COOKIE = "rn_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** Encrypt session data and return a base64url-encoded ciphertext. */
async function encryptSession(data: SessionData, env: Env): Promise<string> {
  const key = await importAesKey(env.TOKEN_ENCRYPTION_KEY);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  // Prepend IV so we can recover it on decryption
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return bytesToBase64url(combined.buffer);
}

/** Decrypt and return session data, or null if invalid. */
async function decryptSession(token: string, env: Env): Promise<SessionData | null> {
  let combined: Uint8Array;
  try {
    combined = base64urlToBytes(token);
  } catch {
    return null;
  }
  if (combined.length < 13) return null;
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  try {
    const key = await importAesKey(env.TOKEN_ENCRYPTION_KEY);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext)) as SessionData;
  } catch {
    return null;
  }
}

/** Parse the session cookie from a request, returning SessionData or null. */
async function getSession(request: Request, env: Env): Promise<SessionData | null> {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)rn_session=([^;]+)/);
  if (!match) return null;
  return decryptSession(match[1], env);
}

/** Build a Set-Cookie header value for the session cookie. */
async function makeSessionCookie(data: SessionData, env: Env): Promise<string> {
  const value = await encryptSession(data, env);
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

/** Build a Set-Cookie header value that clears the session cookie. */
function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

async function refreshAccessToken(session: SessionData, env: Env): Promise<SessionData | null> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
    client_id: env.INTERVALS_CLIENT_ID,
    client_secret: env.INTERVALS_CLIENT_SECRET,
  });
  const resp = await fetch(env.INTERVALS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) return null;
  const token = (await resp.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    athleteId: session.athleteId,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? session.refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + (token.expires_in ?? 3600),
  };
}

/**
 * Ensure the session has a valid access token.
 *
 * If the token is within 5 minutes of expiry, a refresh is attempted.
 * Returns the (possibly refreshed) session, or null if refresh failed.
 */
async function ensureFreshSession(session: SessionData, env: Env): Promise<SessionData | null> {
  const now = Math.floor(Date.now() / 1000);
  if (session.expiresAt - now > 300) return session;
  return refreshAccessToken(session, env);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /oauth/authorize
 *
 * Redirect the user to intervals.icu with a signed state parameter.
 * No cookie is used for state storage, which is the key fix for iOS.
 */
async function handleAuthorize(env: Env): Promise<Response> {
  const state = await generateState(env);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.INTERVALS_CLIENT_ID,
    redirect_uri: env.REDIRECT_URI,
    scope: "ACTIVITY:READ",
    state,
  });
  return Response.redirect(`${env.INTERVALS_AUTHORIZE_URL}?${params}`, 302);
}

/**
 * GET /oauth/callback?code=...&state=...
 *
 * Validate the state, exchange the code for tokens, create a session,
 * and redirect to the site home page.
 */
async function handleCallback(url: URL, env: Env): Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(`OAuth error: ${error}`, { status: 400 });
  }
  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  // Validate the HMAC-signed state (the iOS-compatible check)
  const valid = await validateState(state, env);
  if (!valid) {
    return new Response("Invalid state", { status: 400 });
  }

  // Exchange code for tokens
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.REDIRECT_URI,
    client_id: env.INTERVALS_CLIENT_ID,
    client_secret: env.INTERVALS_CLIENT_SECRET,
  });
  const tokenResp = await fetch(env.INTERVALS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!tokenResp.ok) {
    const text = await tokenResp.text();
    return new Response(`Token exchange failed: ${text}`, { status: 502 });
  }
  const tokenData = (await tokenResp.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
    athlete_id?: string | number;
  };

  // Fetch athlete ID from intervals.icu if not in token response
  let athleteId = tokenData.athlete_id ? String(tokenData.athlete_id) : "";
  if (!athleteId) {
    const meResp = await fetch(`${env.INTERVALS_API_BASE}/athlete`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (meResp.ok) {
      const me = (await meResp.json()) as { id?: string | number };
      athleteId = me.id ? String(me.id) : "";
    }
  }
  if (!athleteId) {
    return new Response("Could not determine athlete ID", { status: 502 });
  }

  const session: SessionData = {
    athleteId,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + (tokenData.expires_in ?? 3600),
  };

  const cookie = await makeSessionCookie(session, env);
  return new Response(null, {
    status: 302,
    headers: {
      Location: env.SITE_BASE + "/",
      "Set-Cookie": cookie,
    },
  });
}

/**
 * GET /oauth/logout
 *
 * Clear the session cookie and redirect to the home page.
 */
function handleLogout(env: Env): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: env.SITE_BASE + "/",
      "Set-Cookie": clearSessionCookie(),
    },
  });
}

/**
 * GET /api/me
 *
 * Return `{ athleteId, liked }` for the authenticated user, or 401.
 * Refreshes the access token if needed and updates the session cookie.
 */
async function handleMe(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env);
  if (!session) {
    return jsonResponse({ athleteId: null, liked: [] }, 401);
  }

  const fresh = await ensureFreshSession(session, env);
  if (!fresh) {
    return new Response("Session expired", {
      status: 401,
      headers: { "Set-Cookie": clearSessionCookie() },
    });
  }

  // Load liked courses from KV
  const kvKey = `liked:${fresh.athleteId}`;
  const raw = await env.KV.get(kvKey);
  const liked: string[] = raw ? (JSON.parse(raw) as string[]) : [];

  const responseInit: ResponseInit = {};
  if (fresh !== session) {
    // Token was refreshed — update the cookie
    const cookie = await makeSessionCookie(fresh, env);
    responseInit.headers = { "Set-Cookie": cookie };
  }

  return jsonResponse({ athleteId: fresh.athleteId, liked }, 200, responseInit);
}

/**
 * POST /rowers/courses/{id}/follow/
 *
 * Add a course to the authenticated user's liked list.
 */
async function handleFollow(request: Request, env: Env, courseId: string): Promise<Response> {
  const session = await getSession(request, env);
  if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
  const fresh = await ensureFreshSession(session, env);
  if (!fresh) return jsonResponse({ error: "Session expired" }, 401);

  const kvKey = `liked:${fresh.athleteId}`;
  const raw = await env.KV.get(kvKey);
  const liked: string[] = raw ? (JSON.parse(raw) as string[]) : [];
  if (!liked.includes(courseId)) liked.push(courseId);
  await env.KV.put(kvKey, JSON.stringify(liked));

  const responseInit: ResponseInit = {};
  if (fresh !== session) {
    const cookie = await makeSessionCookie(fresh, env);
    responseInit.headers = { "Set-Cookie": cookie };
  }
  return jsonResponse({ liked: liked.map((id) => ({ id })) }, 200, responseInit);
}

/**
 * POST /rowers/courses/{id}/unfollow/
 *
 * Remove a course from the authenticated user's liked list.
 */
async function handleUnfollow(request: Request, env: Env, courseId: string): Promise<Response> {
  const session = await getSession(request, env);
  if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
  const fresh = await ensureFreshSession(session, env);
  if (!fresh) return jsonResponse({ error: "Session expired" }, 401);

  const kvKey = `liked:${fresh.athleteId}`;
  const raw = await env.KV.get(kvKey);
  const liked: string[] = raw ? (JSON.parse(raw) as string[]) : [];
  const updated = liked.filter((id) => id !== courseId);
  await env.KV.put(kvKey, JSON.stringify(updated));

  const responseInit: ResponseInit = {};
  if (fresh !== session) {
    const cookie = await makeSessionCookie(fresh, env);
    responseInit.headers = { "Set-Cookie": cookie };
  }
  return jsonResponse({ liked: updated.map((id) => ({ id })) }, 200, responseInit);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { ...init, status, headers });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": env.SITE_BASE,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Credentials": "true",
        },
      });
    }

    if (path === "/oauth/authorize" && method === "GET") {
      return handleAuthorize(env);
    }
    if (path === "/oauth/callback" && method === "GET") {
      return handleCallback(url, env);
    }
    if (path === "/oauth/logout" && method === "GET") {
      return handleLogout(env);
    }
    if (path === "/api/me" && method === "GET") {
      return handleMe(request, env);
    }

    // Follow / unfollow
    const followMatch = path.match(/^\/rowers\/courses\/([^/]+)\/follow\/?$/);
    if (followMatch && method === "POST") {
      return handleFollow(request, env, followMatch[1]);
    }
    const unfollowMatch = path.match(/^\/rowers\/courses\/([^/]+)\/unfollow\/?$/);
    if (unfollowMatch && method === "POST") {
      return handleUnfollow(request, env, unfollowMatch[1]);
    }

    return new Response("Not Found", { status: 404 });
  },
};
