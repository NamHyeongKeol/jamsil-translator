import React, { useEffect, useMemo, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  addNativeSttListener,
  isNativeSttAvailable,
  startNativeStt,
  stopNativeStt,
} from './src/nativeStt';

const DEFAULT_WS_URL = 'wss://mingle.up.railway.app';
const DEFAULT_LANGUAGES = 'ko,en,th';

function formatRaw(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}

function appendLog(prev: string[], next: string): string[] {
  const merged = [...prev, next];
  return merged.length > 100 ? merged.slice(merged.length - 100) : merged;
}

function App(): React.JSX.Element {
  const nativeAvailable = useMemo(() => isNativeSttAvailable(), []);
  const [wsUrl, setWsUrl] = useState(DEFAULT_WS_URL);
  const [languagesText, setLanguagesText] = useState(DEFAULT_LANGUAGES);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    const statusSub = addNativeSttListener('status', event => {
      setStatus(event.status);
      setLogs(prev => appendLog(prev, `[status] ${event.status}`));
    });

    const messageSub = addNativeSttListener('message', event => {
      setLogs(prev => appendLog(prev, `[message] ${formatRaw(event.raw)}`));
    });

    const errorSub = addNativeSttListener('error', event => {
      setErrorText(event.message);
      setLogs(prev => appendLog(prev, `[error] ${event.message}`));
    });

    const closeSub = addNativeSttListener('close', event => {
      setIsRunning(false);
      setStatus('closed');
      setLogs(prev => appendLog(prev, `[close] ${event.reason}`));
    });

    return () => {
      statusSub.remove();
      messageSub.remove();
      errorSub.remove();
      closeSub.remove();
    };
  }, []);

  const onStart = async () => {
    if (!nativeAvailable || isRunning) {
      return;
    }

    setErrorText(null);
    setStatus('starting');

    const languages = languagesText
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);

    try {
      const result = await startNativeStt({
        wsUrl: wsUrl.trim(),
        languages,
        sttModel: 'soniox',
        langHintsStrict: true,
      });
      setIsRunning(true);
      setStatus('running');
      setLogs(prev => appendLog(prev, `[start] sampleRate=${result.sampleRate}`));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('failed');
      setErrorText(message);
      setLogs(prev => appendLog(prev, `[start_failed] ${message}`));
    }
  };

  const onStop = async () => {
    if (!nativeAvailable) {
      return;
    }

    try {
      await stopNativeStt({
        pendingText: '',
        pendingLanguage: 'ko',
      });
      setIsRunning(false);
      setStatus('stopped');
      setLogs(prev => appendLog(prev, '[stop] requested'));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorText(message);
      setLogs(prev => appendLog(prev, `[stop_failed] ${message}`));
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        <Text style={styles.title}>Mingle RN Native STT</Text>
        <Text style={styles.subtitle}>mingle-app/rn</Text>

        <View style={styles.card}>
          <Text style={styles.label}>WebSocket URL</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setWsUrl}
            placeholder="wss://mingle.up.railway.app"
            placeholderTextColor="#6b7280"
            style={styles.input}
            value={wsUrl}
          />

          <Text style={styles.label}>Languages (comma-separated)</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setLanguagesText}
            placeholder="ko,en,th"
            placeholderTextColor="#6b7280"
            style={styles.input}
            value={languagesText}
          />

          <View style={styles.row}>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={!nativeAvailable || isRunning}
              onPress={onStart}
              style={[styles.button, styles.buttonPrimary, (!nativeAvailable || isRunning) && styles.buttonDisabled]}
            >
              <Text style={styles.buttonText}>Start</Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              disabled={!nativeAvailable || !isRunning}
              onPress={onStop}
              style={[styles.button, styles.buttonSecondary, (!nativeAvailable || !isRunning) && styles.buttonDisabled]}
            >
              <Text style={styles.buttonText}>Stop</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.meta}>Native module: {nativeAvailable ? 'available' : 'unavailable'}</Text>
          <Text style={styles.meta}>Status: {status}</Text>
          {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
        </View>

        <View style={[styles.card, styles.logsCard]}>
          <Text style={styles.label}>Events</Text>
          <ScrollView style={styles.logsScroll}>
            {logs.length === 0 ? <Text style={styles.logLine}>No events yet.</Text> : null}
            {logs.map((line, index) => (
              <Text key={`${line}-${index}`} style={styles.logLine}>
                {line}
              </Text>
            ))}
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#030712',
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  title: {
    color: '#f9fafb',
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: '#93c5fd',
    fontSize: 13,
  },
  card: {
    borderColor: '#1f2937',
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: '#0b1220',
    padding: 12,
    gap: 8,
  },
  logsCard: {
    flex: 1,
  },
  label: {
    color: '#d1d5db',
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    borderColor: '#374151',
    borderRadius: 10,
    borderWidth: 1,
    color: '#f3f4f6',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  button: {
    borderRadius: 10,
    flex: 1,
    paddingVertical: 12,
  },
  buttonPrimary: {
    backgroundColor: '#2563eb',
  },
  buttonSecondary: {
    backgroundColor: '#4b5563',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: '#f9fafb',
    textAlign: 'center',
    fontWeight: '700',
  },
  meta: {
    color: '#9ca3af',
    fontSize: 12,
  },
  error: {
    color: '#fca5a5',
    fontSize: 12,
  },
  logsScroll: {
    flex: 1,
    marginTop: 2,
  },
  logLine: {
    color: '#d1d5db',
    fontSize: 12,
    marginBottom: 6,
  },
});

export default App;
