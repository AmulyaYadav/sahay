// Metro config for a standalone Expo app that consumes @sahay/shared from the
// monorepo via a `file:` dependency (symlinked into node_modules).
// `expo/metro-config` is Expo's documented entry point and resolves whichever
// copy of @expo/metro-config npm actually installed.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the shared package's real location so edits there trigger rebuilds,
// and the root node_modules so workspace-hoisted deps (zod) are indexed.
config.watchFolders = [
  path.resolve(repoRoot, 'packages/shared'),
  path.resolve(repoRoot, 'node_modules'),
];

// Resolve modules from the app's own node_modules first, then the repo root
// (where workspace-hoisted deps like zod live).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(repoRoot, 'node_modules'),
];

module.exports = config;
