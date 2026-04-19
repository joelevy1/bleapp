/**
 * Removes aps-environment so Ad Hoc / internal builds match provisioning profiles
 * that do not include Push Notifications (this app does not use remote push).
 */
const { withEntitlementsPlist } = require('@expo/config-plugins');

module.exports = function withRemovePushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    if (cfg.modResults && cfg.modResults['aps-environment'] !== undefined) {
      delete cfg.modResults['aps-environment'];
    }
    return cfg;
  });
};
