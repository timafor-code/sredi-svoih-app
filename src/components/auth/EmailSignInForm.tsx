import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/ui/FormField';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useAuthStore } from '@/store/useAuthStore';
import { colors } from '@/theme/colors';

import { AUTH_ERROR_MESSAGES, getAuthErrorMessage } from './authErrorMessages';

type EmailSignInFormProps = {
  initialEmail?: string;
  onEmailChange?: (email: string) => void;
  onForgotPassword: () => void;
  onSignedIn: () => Promise<void> | void;
};

export function EmailSignInForm({
  initialEmail = '',
  onEmailChange,
  onForgotPassword,
  onSignedIn,
}: EmailSignInFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const signIn = useAuthStore((state) => state.signIn);

  useEffect(() => {
    setEmail(initialEmail);
  }, [initialEmail]);

  const handleEmailChange = useCallback((value: string) => {
    setEmail(value);
    onEmailChange?.(value);
  }, [onEmailChange]);

  const handleSubmit = useCallback(async () => {
    setLocalError(null);

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !password) {
      setLocalError(AUTH_ERROR_MESSAGES.signIn);
      return;
    }

    setIsSubmitting(true);

    try {
      await signIn(normalizedEmail, password);
      setPassword('');
      await onSignedIn();
    } catch (error) {
      setLocalError(getAuthErrorMessage(error, AUTH_ERROR_MESSAGES.signIn));
    } finally {
      setIsSubmitting(false);
    }
  }, [email, onSignedIn, password, signIn]);

  return (
    <View style={styles.form}>
      <FormField
        label="Email"
        value={email}
        onChangeText={handleEmailChange}
        keyboardType="email-address"
        placeholder="name@example.com"
      />
      <FormField
        label="Пароль"
        value={password}
        onChangeText={setPassword}
        placeholder="Пароль"
        secureTextEntry
      />
      <PrimaryButton
        title={isSubmitting ? 'Входим...' : 'Войти'}
        disabled={isSubmitting}
        onPress={handleSubmit}
      />
      <Pressable
        accessibilityRole="button"
        onPress={onForgotPassword}
        style={({ pressed }) => [styles.forgotButton, pressed && styles.pressed]}
      >
        <Text style={styles.forgotText}>Забыли пароль?</Text>
      </Pressable>
      {localError ? <Text style={styles.errorText}>{localError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: 12,
  },
  forgotButton: {
    alignSelf: 'center',
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  forgotText: {
    color: colors.accent.goldText,
    fontSize: 13,
    fontWeight: '700',
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
  },
  pressed: {
    opacity: 0.78,
  },
});
