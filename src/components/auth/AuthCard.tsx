import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { SegmentControl } from '@/components/ui/SegmentControl';
import { useAuthStore } from '@/store/useAuthStore';
import { colors } from '@/theme/colors';

import { getAuthErrorMessage } from './authErrorMessages';
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
  const [oauthError, setOAuthError] = useState<string | null>(null);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

  const signInWithGoogle = useAuthStore((state) => state.signInWithGoogle);

  const handleSwitchToSignIn = useCallback((nextEmail?: string) => {
    if (nextEmail) {
      setEmail(nextEmail);
    }

    setOAuthError(null);
    setMode('Войти');
  }, []);

  const handleForgotPassword = useCallback(() => {
    setOAuthError(null);
    setMode('forgotPassword');
  }, []);

  const handleTabChange = useCallback((nextMode: AuthTab) => {
    setOAuthError(null);
    setMode(nextMode);
  }, []);

  const handleGoogleSignIn = useCallback(async () => {
    setOAuthError(null);
    setIsGoogleSubmitting(true);

    try {
      await signInWithGoogle();
      await onSignedIn();
    } catch (error) {
      setOAuthError(getAuthErrorMessage(error, 'Не удалось войти через Google. Попробуйте ещё раз.'));
    } finally {
      setIsGoogleSubmitting(false);
    }
  }, [onSignedIn, signInWithGoogle]);

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

      {mode !== 'forgotPassword' ? (
        <View style={styles.oauthBlock}>
          <Pressable
            accessibilityRole="button"
            disabled={isGoogleSubmitting}
            onPress={handleGoogleSignIn}
            style={({ pressed }) => [
              styles.googleButton,
              isGoogleSubmitting && styles.googleButtonDisabled,
              pressed && !isGoogleSubmitting && styles.pressed,
            ]}
          >
            <View style={styles.googleIcon}>
              <Text style={styles.googleIconText}>G</Text>
            </View>
            <Text numberOfLines={1} style={styles.googleButtonText}>
              {isGoogleSubmitting ? 'Открываем Google...' : 'Продолжить с Google'}
            </Text>
          </Pressable>
          {oauthError ? <Text style={styles.errorText}>{oauthError}</Text> : null}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>или</Text>
            <View style={styles.dividerLine} />
          </View>
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
  oauthBlock: {
    gap: 10,
    marginBottom: 14,
  },
  googleButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.glass.w06,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  googleButtonDisabled: {
    opacity: 0.55,
  },
  googleIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.glass.w16,
    backgroundColor: colors.text,
  },
  googleIconText: {
    color: colors.bg,
    fontSize: 14,
    fontWeight: '800',
    includeFontPadding: false,
  },
  googleButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    includeFontPadding: false,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.separator,
  },
  dividerText: {
    color: colors.textGhost,
    fontSize: 12,
    fontWeight: '700',
    includeFontPadding: false,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.78,
  },
});
