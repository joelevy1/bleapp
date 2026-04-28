/**
 * Removes aps-environment so Ad Hoc / internal builds match provisioning profiles
 * that do not include Push Notifications (this app does not use remote push).
 */
const path = require('path');

function loadConfigPlugins() {
  try {
    return require('@expo/config-plugins');
  } catch {
    const expoDir = path.dirname(require.resolve('expo/package.json'));
    return require(require.resolve('@expo/config-plugins', { paths: [expoDir] }));
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
