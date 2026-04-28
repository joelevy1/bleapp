/**
 * Removes aps-environment so Ad Hoc / internal builds match provisioning profiles
 * that do not include Push Notifications (this app does not use remote push).
 */
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');

/** Resolve without relying on expo hoisting / require('expo/package.json'), so CLI works before npm install completes on Windows paths. */
function loadConfigPlugins() {
  try {
    return require('@expo/config-plugins');
  } catch {
    const tryPaths = [
      path.join(PROJECT_ROOT, 'node_modules', '@expo', 'config-plugins'),
      path.join(
        PROJECT_ROOT,
        'node_modules',
        'expo',
        'node_modules',
        '@expo',
        'config-plugins'
      ),
    ];
    for (const dir of tryPaths) {
      if (fs.existsSync(path.join(dir, 'package.json'))) {
        return require(dir);
      }
    }
    throw new Error(
      '[withRemovePushEntitlement] Could not load @expo/config-plugins. From the repo root run: npm install'
    );
  }
}

const { withEntitlementsPlist } = loadConfigPlugins();

module.exports = function withRemovePushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    if (cfg.modResults && cfg.modResults['aps-environment'] !== undefined) {
      delete cfg.modResults['aps-environment'];
    }
    return cfg;
  });
};
