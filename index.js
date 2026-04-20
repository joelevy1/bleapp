import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { registerRootComponent } from 'expo';
import App from './App';

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
  errorTitle: {
    fontSize: 18,
    marginBottom: 12,
    color: '#b71c1c',
    ...(Platform.OS === 'ios' ? {} : { fontWeight: '700' }),
  },
  errorScroll: { flex: 1 },
  errorBody: { fontSize: 13, color: '#333' },
});

function AppRoot() {
  return (
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  );
}

registerRootComponent(AppRoot);
