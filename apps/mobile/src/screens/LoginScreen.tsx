import React, { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Screen } from '../components/Screen';
import { useAuth } from '../context/AuthContext';

function extractTokenFromUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/[?&]token=([^&]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function LoginScreen() {
  const route = useRoute();
  const { login, verifyLoginOtp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [deepLinkHint, setDeepLinkHint] = useState('');

  useEffect(() => {
    const fromRoute = (route.params as { resetToken?: string } | undefined)?.resetToken;
    if (fromRoute) {
      setDeepLinkHint('Password reset link opened. Finish reset on web or continue sign-in here.');
    }
    const applyUrl = (url: string | null) => {
      const token = extractTokenFromUrl(url);
      if (token) {
        setDeepLinkHint('Password reset link opened. Finish reset on web or continue sign-in here.');
      }
    };
    Linking.getInitialURL().then(applyUrl);
    const sub = Linking.addEventListener('url', (e) => applyUrl(e.url));
    return () => sub.remove();
  }, [route.params]);

  const onLogin = async () => {
    setBusy(true);
    try {
      const data: any = await login(email.trim(), password);
      if (data?.requiresOtp) {
        setStep('otp');
        Alert.alert('OTP sent', data.message || 'Check your email for the 6-digit code.');
      }
    } catch (error: any) {
      Alert.alert('Login failed', error?.response?.data?.error || 'Please check your credentials.');
    } finally {
      setBusy(false);
    }
  };

  const onVerifyOtp = async () => {
    setBusy(true);
    try {
      await verifyLoginOtp(email.trim(), otp.replace(/\D/g, '').slice(0, 6));
    } catch (error: any) {
      Alert.alert('Verification failed', error?.response?.data?.error || 'Invalid code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={styles.card}>
        <Text style={styles.title}>GoOut</Text>
        <Text style={styles.subtitle}>
          {step === 'credentials' ? 'Sign in to continue' : 'Enter the 6-digit verification code'}
        </Text>

        {deepLinkHint ? <Text style={styles.hint}>{deepLinkHint}</Text> : null}

        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholder="Email"
          editable={!busy}
        />

        {step === 'credentials' ? (
          <>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Password"
              editable={!busy}
            />
            <Pressable style={styles.button} onPress={onLogin} disabled={busy}>
              <Text style={styles.buttonLabel}>{busy ? 'Please wait...' : 'Sign in'}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <TextInput
              style={styles.input}
              value={otp}
              onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              placeholder="000000"
              editable={!busy}
              maxLength={6}
            />
            <Pressable style={styles.button} onPress={onVerifyOtp} disabled={busy || otp.length !== 6}>
              <Text style={styles.buttonLabel}>{busy ? 'Verifying...' : 'Verify'}</Text>
            </Pressable>
            <Pressable onPress={() => setStep('credentials')} disabled={busy}>
              <Text style={styles.link}>Back to password login</Text>
            </Pressable>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    justifyContent: 'center',
    gap: 12,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: '#0f766e',
  },
  subtitle: {
    color: '#334155',
    marginBottom: 6,
  },
  hint: {
    color: '#0369a1',
    fontSize: 13,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    backgroundColor: 'white',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  button: {
    backgroundColor: '#0f766e',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 12,
  },
  buttonLabel: {
    color: 'white',
    fontWeight: '700',
  },
  link: {
    color: '#0f766e',
    textAlign: 'center',
    marginTop: 8,
  },
});
