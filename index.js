import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { registerRootComponent } from 'expo';

/**
 * Catches render errors so production builds show the JS message instead of SIGABRT
 * (see device .ips: com.facebook.react.ExceptionsManagerQueue).
 */
class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidCatch(err, info) {
    console.error('[RootErrorBoundary]', err, info?.componentStack);
  }

  render() {
    const { err } = this.state;
    if (err) {
      const msg = err?.message != null ? String(err.message) : String(err);
      const stack = err?.stack != null ? String(err.stack) : '';
      return (
        <View style={styles.errorWrap}>
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <ScrollView style={styles.errorScroll}>
            <Text selectable style={styles.errorBody}>
              {msg}
              {stack ? `\n\n${stack}` : ''}
            </Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  errorWrap: { flex: 1, padding: 16, paddingTop: 48, backgroundColor: '#fff' },
  errorTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12, color: '#b71c1c' },
  errorScroll: { flex: 1 },
  errorBody: { fontSize: 13, fontFamily: 'Courier', color: '#333' },
});

/**
 * Load App after first frame; native modules in App.js evaluate after import().
 */
function DeferredRoot() {
  const [AppMod, setAppMod] = useState(null);
  const [loadErr, setLoadErr] = useState(null);

  useEffect(() => {
    import('./App')
      .then((m) => setAppMod(() => m.default))
      .catch((e) => setLoadErr(e));
  }, []);

  if (loadErr) {
    const msg = loadErr?.message != null ? String(loadErr.message) : String(loadErr);
    return (
      <View style={styles.errorWrap}>
        <Text style={styles.errorTitle}>Failed to load app bundle</Text>
        <Text selectable style={styles.errorBody}>
          {msg}
        </Text>
      </View>
    );
  }

  if (!AppMod) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator size="large" color="#1976D2" />
      </View>
    );
  }

  return (
    <RootErrorBoundary>
      <AppMod />
    </RootErrorBoundary>
  );
}

registerRootComponent(DeferredRoot);
