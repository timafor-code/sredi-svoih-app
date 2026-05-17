import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/ui/FormField';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useAuthStore } from '@/store/useAuthStore';
import { colors } from '@/theme/colors';

import { getAuthErrorMessage } from './authErrorMessages';

const RESET_PASSWORD_SUCCESS_MESSAGE = 'Если такой email зарегистрирован, мы отправили ссылку для восстановления.';

type ForgotPasswordFormProps = {
  initialEmail?: string;
  onBackToSignIn: (email?: string) => void;
  onEmailChange?: (email: string) => void;
};

export function ForgotPasswordForm({
  initialEmail = '',
  onBackToSignIn,
  onEmailChange,
}: ForgotPasswordFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [localError, setLocalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetPasswordForEmail = useAuthStore((state) => state.resetPasswordForEmail);

  useEffect(() => {
    setEmail(initialEmail);
  }, [initialEmail]);

  const handleEmailChange = useCallback((value: string) => {
    setEmail(value);
    setSuccessMessage(null);
    onEmailChange?.(value);
  }, [onEmailChange]);

  const handleSubmit = useCallback(async () => {
    setLocalError(null);
    setSuccessMessage(null);

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setLocalError('Введите email для восстановления пароля.');
      return;
    }

    setIsSubmitting(true);

    try {
      await resetPasswordForEmail(normalizedEmail);
      setSuccessMessage(RESET_PASSWORD_SUCCESS_MESSAGE);
      onEmailChange?.(normalizedEmail);
    } catch (error) {
      setLocalError(getAuthErrorMessage(error, 'Не удалось отправить ссылку. Попробуйте позже.'));
    } finally {
      setIsSubmitting(false);
    }
  }, [email, onEmailChange, resetPasswordForEmail]);

  return (
    <View style={styles.form}>
      <FormField
        label="Email"
        value={email}
        onChangeText={handleEmailChange}
        keyboardType="email-address"
        placeholder="name@example.com"
      />
      <PrimaryButton
        title={isSubmitting ? 'Отправляем...' : 'Отправить ссылку для восстановления'}
        disabled={isSubmitting}
        onPress={handleSubmit}
        textNumberOfLines={2}
        buttonStyle={styles.submitButton}
      />
      <Pressable
        accessibilityRole="button"
        onPress={() => onBackToSignIn(email.trim().toLowerCase())}
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
      >
        <Text style={styles.backButtonText}>Назад ко входу</Text>
      </Pressable>
      {successMessage ? <Text style={styles.successText}>{successMessage}</Text> : null}
      {localError ? <Text style={styles.errorText}>{localError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: 12,
  },
  backButton: {
    alignSelf: 'center',
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  submitButton: {
    minHeight: 48,
    paddingHorizontal: 12,
  },
  backButtonText: {
    color: colors.accent.goldText,
    fontSize: 13,
    fontWeight: '800',
  },
  successText: {
    color: colors.success,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
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
