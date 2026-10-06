/**
 * Single source of truth for the JWT signing secret (used by JwtModule and JwtStrategy).
 *
 * A guessable secret lets anyone forge a token for any user of any vendor, so in production a
 * missing secret — or the old hardcoded development fallback — is a startup error rather than a
 * silent default. Outside production the dev fallback is kept so local runs and tests still work.
 */
export const INSECURE_DEV_JWT_SECRET = 'super-secret-key';

export function getJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env['JWT_SECRET'];
  if (env['NODE_ENV'] === 'production' && (!secret || secret === INSECURE_DEV_JWT_SECRET)) {
    throw new Error(
      'JWT_SECRET must be set to a strong, unique value in production (it is missing or equals the insecure development default).',
    );
  }
  return secret || INSECURE_DEV_JWT_SECRET;
}

/** Only the SSE stream may authenticate with `?token=` (EventSource cannot send headers). */
export const QUERY_TOKEN_ROUTES: readonly RegExp[] = [/\/tracking\/subscribe\/?$/];

export function allowsQueryToken(path: string | undefined): boolean {
  const p = (path ?? '').split('?')[0];
  return QUERY_TOKEN_ROUTES.some((re) => re.test(p));
}
