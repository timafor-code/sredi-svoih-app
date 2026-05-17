import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/ui/FormField';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useAuthStore } from '@/store/useAuthStore';
import { colors } from '@/theme/colors';

import { AUTH_ERROR_MESSAGES, getAuthErrorMessage } from './authErrorMessages';

type EmailSignUpFormProps = {
  initialEmail?: string;
  onEmailChange?: (email: string) => void;
  onSignedIn: () => Promise<void> | void;
  onSwitchToSignIn: (email?: string) => void;
};

export function EmailSignUpForm({
  initialEmail = '',
  onEmailChange,
  onSignedIn,
  onSwitchToSignIn,
}: EmailSignUpFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const resendConfirmationEmail = useAuthStore((state) => state.resendConfirmationEmail);
  const signUpWithEmail = useAuthStore((state) => state.signUpWithEmail);

  useEffect(() => {
    setEmail(initialEmail);
  }, [initialEmail]);

  const handleEmailChange = useCallback((value: string) => {
    setEmail(value);
    onEmailChange?.(value);
  }, [onEmailChange]);

  const validate = useCallback((normalizedEmail: string) => {
    if (!normalizedEmail) {
      return 'Введите email для регистрации.';
    }

    if (!password) {
      return 'Введите пароль для регистрации.';
    }

    if (password.length < 6) {
      return AUTH_ERROR_MESSAGES.weakPassword;
    }

    if (password !== repeatPassword) {
      return AUTH_ERROR_MESSAGES.passwordMismatch;
    }

    return null;
  }, [password, repeatPassword]);

  const handleSubmit = useCallback(async () => {
    setLocalError(null);
    setSuccessMessage(null);

    const normalizedEmail = email.trim().toLowerCase();
    const validationError = validate(normalizedEmail);

    if (validationError) {
      setLocalError(validationError);
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await signUpWithEmail(normalizedEmail, password);

      if (result.needsEmailConfirmation) {
        setConfirmationEmail(normalizedEmail);
        setPassword('');
        setRepeatPassword('');
        onEmailChange?.(normalizedEmail);
        return;
      }

      setPassword('');
      setRepeatPassword('');
      await onSignedIn();
    } catch (error) {
      setLocalError(getAuthErrorMessage(error, 'Не удалось создать аккаунт. Попробуйте ещё раз.'));
    } finally {
      setIsSubmitting(false);
    }
  }, [email, onEmailChange, onSignedIn, password, signUpWithEmail, validate]);

  const handleResendConfirmation = useCallback(async () => {
    if (!confirmationEmail) {
      return;
    }

    setLocalError(null);
    setSuccessMessage(null);
    setIsResending(true);

    try {
      await resendConfirmationEmail(confirmationEmail);
      setSuccessMessage('Письмо отправлено ещё раз. Проверьте входящие и спам.');
    } catch (error) {
      setLocalError(getAuthErrorMessage(error, 'Не удалось отправить письмо. Попробуйте позже.'));
    } finally {
      setIsResending(false);
    }
  }, [confirmationEmail, resendConfirmationEmail]);

  if (confirmationEmail) {
    return (
      <View style={styles.confirmationState}>
        <View style={styles.confirmationIcon}>
          <Ionicons name="mail-open-outline" size={24} color={colors.goldAccent} />
        </View>
        <Text style={styles.confirmationTitle}>Проверьте почту</Text>
        <Text style={styles.confirmationText}>
          Мы отправили письмо подтверждения на {confirmationEmail}.
        </Text>
        <PrimaryButton
          title={isResending ? 'Отправляем...' : 'Отправить письмо ещё раз'}
          disabled={isResending}
          onPress={handleResendConfirmation}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => onSwitchToSignIn(confirmationEmail)}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryButtonText}>Уже подтвердил — войти</Text>
        </Pressable>
        {successMessage ? <Text style={styles.successText}>{successMessage}</Text> : null}
        {localError ? <Text style={styles.errorText}>{localError}</Text> : null}
      </View>
    );
  }

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
        placeholder="Минимум 6 символов"
        secureTextEntry
      />
      <FormField
        label="Повторите пароль"
        value={repeatPassword}
        onChangeText={setRepeatPassword}
        placeholder="Ещё раз пароль"
        secureTextEntry
      />
      <PrimaryButton
        title={isSubmitting ? 'Создаём...' : 'Создать аккаунт'}
        disabled={isSubmitting}
        onPress={handleSubmit}
      />
      {localError ? <Text style={styles.errorText}>{localError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: 12,
  },
  confirmationState: {
    alignItems: 'center',
    gap: 12,
  },
  confirmationIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accent.goldBorder,
    backgroundColor: colors.accent.goldBg,
  },
  confirmationTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  confirmationText: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  secondaryButton: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
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
