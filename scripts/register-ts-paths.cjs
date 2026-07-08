/**
 * Preload for standalone TypeScript scripts (e.g. prisma seeders) run via
 * `node -r ./scripts/register-ts-paths.cjs <script>.ts`.
 *
 * Registers ts-node (so .ts is loadable) and the workspace path aliases
 * (@water-supply-crm/*) so scripts can import shared libraries through their public
 * package alias — no reaching into another lib's internal src, no duplicated mappings.
 *
 * The alias table is read from tsconfig.scripts.json (which extends tsconfig.base.json),
 * so there is a single source of truth for path mappings. Cross-platform: no env vars.
 */
const path = require('path');
const tsNode = require('ts-node');
const tsConfigPaths = require('tsconfig-paths');

const projectPath = path.resolve(__dirname, '..', 'tsconfig.scripts.json');

tsNode.register({ project: projectPath });

const config = tsConfigPaths.loadConfig(projectPath);
if (config.resultType === 'success') {
  tsConfigPaths.register({ baseUrl: config.absoluteBaseUrl, paths: config.paths });
} else {
  throw new Error(`register-ts-paths: failed to load ${projectPath}: ${config.message}`);
}
