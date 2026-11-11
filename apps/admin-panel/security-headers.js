//@ts-check
/**
 * Static security headers applied to every route by next.config.js (kept in its own file so a unit test can
 * assert the set without loading the Nx/Next plugins). The nonce-based CSP is set per request in src/middleware.ts.
 * @param {boolean} [isProd]
 */
function securityHeaders(isProd = process.env.NODE_ENV === 'production') {
  return [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
    ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
  ];
}

module.exports = { securityHeaders };
