import { errorResponse, jsonResponse, type OAuthEnv, type PagesFunction } from '../../../_shared';

interface Body {
  code?: string;
  redirect_uri?: string;
  state?: string;
}

export const onRequestPost: PagesFunction<OAuthEnv> = async ({ request, env }) => {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return errorResponse(500, 'GitHub OAuth is not configured');
  }
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return errorResponse(400, 'Invalid JSON body');
  }
  if (!body.code || !body.redirect_uri) {
    return errorResponse(400, 'Missing code or redirect_uri');
  }

  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    client_secret: env.GITHUB_CLIENT_SECRET,
    code: body.code,
    redirect_uri: body.redirect_uri,
  });

  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params,
  });

  if (!res.ok) {
    const text = await res.text();
    return errorResponse(502, `GitHub token exchange failed: ${text}`);
  }

  const data = (await res.json()) as {
    access_token?: string;
    scope?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };

  if (!data.access_token) {
    return errorResponse(400, data.error_description || data.error || 'No access token returned');
  }

  return jsonResponse({
    access_token: data.access_token,
    scope: data.scope,
  });
};
