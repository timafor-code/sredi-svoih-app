import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { SegmentControl } from '@/components/ui/SegmentControl';
import { colors } from '@/theme/colors';

import { EmailSignInForm } from './EmailSignInForm';
import { EmailSignUpForm } from './EmailSignUpForm';
import { ForgotPasswordForm } from './ForgotPasswordForm';

const authTabs = ['Войти', 'Регистрация'] as const;

type AuthTab = (typeof authTabs)[number];
type AuthMode = AuthTab | 'forgotPassword';

type AuthCardProps = {
  onSignedIn: () => Promise<void> | void;
};

export function AuthCard({ onSignedIn }: AuthCardProps) {
  const [mode, setMode] = useState<AuthMode>('Войти');
  const [email, setEmail] = useState('');

  const handleSwitchToSignIn = useCallback((nextEmail?: string) => {
    if (nextEmail) {
      setEmail(nextEmail);
    }

    setMode('Войти');
  }, []);

  const handleForgotPassword = useCallback(() => {
    setMode('forgotPassword');
  }, []);

  const handleTabChange = useCallback((nextMode: AuthTab) => {
    setMode(nextMode);
  }, []);

  return (
    <GlassCard style={styles.card}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <Ionicons name="person-circle-outline" size={30} color={colors.orange} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>Войдите или создайте аккаунт</Text>
          <Text style={styles.subtitle}>
            Аккаунт нужен для записей, профиля, уведомлений и функций общины.
          </Text>
        </View>
      </View>

      {mode !== 'forgotPassword' ? (
        <View style={styles.segment}>
          <SegmentControl items={authTabs} value={mode} onChange={handleTabChange} />
        </View>
      ) : null}

      {mode === 'Войти' ? (
        <EmailSignInForm
          initialEmail={email}
          onEmailChange={setEmail}
          onForgotPassword={handleForgotPassword}
          onSignedIn={onSignedIn}
        />
      ) : null}

      {mode === 'Регистрация' ? (
        <EmailSignUpForm
          initialEmail={email}
          onEmailChange={setEmail}
          onSignedIn={onSignedIn}
          onSwitchToSignIn={handleSwitchToSignIn}
        />
      ) : null}

      {mode === 'forgotPassword' ? (
        <ForgotPasswordForm
          initialEmail={email}
          onBackToSignIn={handleSwitchToSignIn}
          onEmailChange={setEmail}
        />
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    borderColor: colors.borderStrong,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accent.orangeBorder,
    backgroundColor: colors.accent.orangeBg,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  segment: {
    marginBottom: 14,
  },
});
