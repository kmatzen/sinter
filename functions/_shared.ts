// Minimal type for Cloudflare Pages Functions to avoid pulling in
// @cloudflare/workers-types as a project-wide dep. The runtime contract
// is small and stable.
export interface PagesFunctionContext<Env = Record<string, string>> {
  request: Request;
  env: Env;
}

export type PagesFunction<Env = Record<string, string>> = (
  context: PagesFunctionContext<Env>,
) => Response | Promise<Response>;

export interface OAuthEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}

export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(init?.headers || {}),
    },
  });
}

export function errorResponse(status: number, message: string): Response {
  return jsonResponse({ error: message }, { status });
}
