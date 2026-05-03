import { errorResponse, jsonResponse, type OAuthEnv, type PagesFunction } from '../../../_shared';

interface Body {
  code?: string;
  code_verifier?: string;
  redirect_uri?: string;
}

export const onRequestPost: PagesFunction<OAuthEnv> = async ({ request, env }) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return errorResponse(500, 'Google OAuth is not configured');
  }
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return errorResponse(400, 'Invalid JSON body');
  }
  const { code, code_verifier, redirect_uri } = body;
  if (!code || !code_verifier || !redirect_uri) {
    return errorResponse(400, 'Missing code, code_verifier, or redirect_uri');
  }

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    code,
    code_verifier,
    redirect_uri,
    grant_type: 'authorization_code',
  });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    return errorResponse(502, `Google token exchange failed: ${text}`);
  }

  const data = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };

  return jsonResponse({
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    expires_in: data.expires_in ?? 3600,
    scope: data.scope,
  });
};
