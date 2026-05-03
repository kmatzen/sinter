import { errorResponse, jsonResponse, type OAuthEnv, type PagesFunction } from '../../../_shared';

interface Body {
  refresh_token?: string;
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
  if (!body.refresh_token) return errorResponse(400, 'Missing refresh_token');

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: body.refresh_token,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!res.ok) {
    const text = await res.text();
    return errorResponse(502, `Google token refresh failed: ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  return jsonResponse({
    access_token: data.access_token,
    expires_in: data.expires_in ?? 3600,
  });
};
