import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/ui/FormField';
import { MINIMUM_PASSWORD_LENGTH } from '@/services/authValidation';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useAuthStore } from '@/store/useAuthStore';
import { colors } from '@/theme/colors';

import { AUTH_ERROR_MESSAGES, getAuthErrorMessage } from './authErrorMessages';
import { EmailVerificationCodeForm } from './EmailVerificationCodeForm';

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
  const [isSubmitting, setIsSubmitting] = useState(false);

  const signUpWithEmail = useAuthStore((state) => state.signUpWithEmail);

  useEffect(() => {
    setEmail(initialEmail);
  }, [initialEmail]);

  const handleEmailChange = useCallback((value: string) => {
    setEmail(value);
    onEmailChange?.(value);
  }, [onEmailChange]);

  const passwordMatchStatus = (
    password.length > 0
    && repeatPassword.length > 0
    && repeatPassword.length >= password.length
  )
    ? repeatPassword === password
      ? 'match'
      : 'mismatch'
    : null;

  const validate = useCallback((normalizedEmail: string) => {
    if (!normalizedEmail) {
      return 'Введите email для регистрации.';
    }

    if (!password) {
      return 'Введите пароль для регистрации.';
    }

    if (password.length < MINIMUM_PASSWORD_LENGTH) {
      return AUTH_ERROR_MESSAGES.weakPassword;
    }

    if (password !== repeatPassword) {
      return AUTH_ERROR_MESSAGES.passwordMismatch;
    }

    return null;
  }, [password, repeatPassword]);

  const handleSubmit = useCallback(async () => {
    setLocalError(null);

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

  const handleVerified = useCallback(async () => {
    setPassword('');
    setRepeatPassword('');
    setConfirmationEmail(null);
    await onSignedIn();
  }, [onSignedIn]);

  if (confirmationEmail) {
    return (
      <EmailVerificationCodeForm
        backLabel="Уже подтвердил — войти"
        email={confirmationEmail}
        onBack={() => onSwitchToSignIn(confirmationEmail)}
        onVerified={handleVerified}
        password={password}
      />
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
        placeholder="Минимум 8 символов"
        secureTextEntry
      />
      <FormField
        label="Повторите пароль"
        value={repeatPassword}
        onChangeText={setRepeatPassword}
        placeholder="Ещё раз пароль"
        secureTextEntry
      />
      {passwordMatchStatus ? (
        <View
          accessible
          accessibilityLabel={passwordMatchStatus === 'match' ? 'Пароли совпадают' : 'Пароли не совпадают'}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={[
            styles.passwordMatchBadge,
            passwordMatchStatus === 'match'
              ? styles.passwordMatchBadgeSuccess
              : styles.passwordMatchBadgeError,
          ]}
        >
          <Ionicons
            name={passwordMatchStatus === 'match' ? 'checkmark-circle' : 'alert-circle'}
            size={16}
            color={passwordMatchStatus === 'match' ? colors.success : colors.danger}
          />
          <Text
            style={[
              styles.passwordMatchText,
              passwordMatchStatus === 'match'
                ? styles.passwordMatchTextSuccess
                : styles.passwordMatchTextError,
            ]}
          >
            {passwordMatchStatus === 'match' ? 'Пароли совпадают' : 'Пароли не совпадают'}
          </Text>
        </View>
      ) : null}
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
  passwordMatchBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  passwordMatchBadgeSuccess: {
    backgroundColor: colors.accent.greenBg,
    borderColor: colors.accent.greenBorder,
  },
  passwordMatchBadgeError: {
    backgroundColor: colors.accent.redBg,
    borderColor: colors.accent.redBorder,
  },
  passwordMatchText: {
    fontSize: 12,
    fontWeight: '800',
  },
  passwordMatchTextSuccess: {
    color: colors.success,
  },
  passwordMatchTextError: {
    color: colors.danger,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
});
