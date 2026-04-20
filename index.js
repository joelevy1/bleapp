import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { registerRootComponent } from 'expo';

/**
 * Load the real app after the first frame so native modules inside App.js are not
 * initialized during the initial bridge startup (avoids immediate launch crashes).
 */
function DeferredRoot() {
  const [AppMod, setAppMod] = useState(null);

  useEffect(() => {
    import('./App').then((m) => setAppMod(() => m.default));
  }, []);

  if (!AppMod) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator size="large" color="#1976D2" />
      </View>
    );
  }

  return <AppMod />;
}

registerRootComponent(DeferredRoot);
