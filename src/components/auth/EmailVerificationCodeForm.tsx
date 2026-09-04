import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/ui/FormField';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useAuthStore } from '@/store/useAuthStore';
import { colors } from '@/theme/colors';

import { getAuthErrorMessage } from './authErrorMessages';

type EmailVerificationCodeFormProps = {
  backLabel?: string;
  email: string;
  onBack?: () => void;
  onVerified: () => Promise<void> | void;
  password: string;
};

export function EmailVerificationCodeForm({
  backLabel = 'Назад',
  email,
  onBack,
  onVerified,
  password,
}: EmailVerificationCodeFormProps) {
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const confirmEmailVerification = useAuthStore((state) => state.confirmEmailVerification);
  const resendConfirmationEmail = useAuthStore((state) => state.resendConfirmationEmail);
  const signIn = useAuthStore((state) => state.signIn);

  const handleSubmit = useCallback(async () => {
    setLocalError(null);
    setSuccessMessage(null);

    const trimmedCode = code.trim();

    if (!trimmedCode) {
      setLocalError('Введите код из письма.');
      return;
    }

    setIsSubmitting(true);

    try {
      await confirmEmailVerification(trimmedCode);
      await signIn(email, password);
      setCode('');
      await onVerified();
    } catch (error) {
      setCode('');
      setLocalError(getAuthErrorMessage(error, 'Не удалось подтвердить email. Попробуйте ещё раз.'));
    } finally {
      setIsSubmitting(false);
    }
  }, [code, confirmEmailVerification, email, onVerified, password, signIn]);

  const handleResend = useCallback(async () => {
    setLocalError(null);
    setSuccessMessage(null);
    setIsResending(true);

    try {
      await resendConfirmationEmail(email);
      setSuccessMessage('Письмо отправлено ещё раз. Проверьте входящие и спам.');
    } catch (error) {
      setLocalError(getAuthErrorMessage(error, 'Не удалось отправить письмо. Попробуйте позже.'));
    } finally {
      setIsResending(false);
    }
  }, [email, resendConfirmationEmail]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <Ionicons name="mail-open-outline" size={24} color={colors.goldAccent} />
        </View>
        <Text style={styles.title}>Подтвердите email</Text>
        <Text style={styles.text}>
          Мы отправили код подтверждения на {email}. Введите его, чтобы завершить вход.
        </Text>
      </View>
      <FormField
        label="Код из письма"
        value={code}
        onChangeText={setCode}
        placeholder="Вставьте код подтверждения"
      />
      <PrimaryButton
        title={isSubmitting ? 'Подтверждаем...' : 'Подтвердить email'}
        disabled={isSubmitting}
        onPress={handleSubmit}
      />
      <Pressable
        accessibilityRole="button"
        disabled={isResending}
        onPress={handleResend}
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
      >
        <Text style={styles.secondaryButtonText}>
          {isResending ? 'Отправляем...' : 'Отправить письмо ещё раз'}
        </Text>
      </Pressable>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryButtonText}>{backLabel}</Text>
        </Pressable>
      ) : null}
      {successMessage ? <Text style={styles.successText}>{successMessage}</Text> : null}
      {localError ? <Text style={styles.errorText}>{localError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  header: {
    alignItems: 'center',
    gap: 12,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accent.goldBorder,
    backgroundColor: colors.accent.goldBg,
  },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  text: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  secondaryButton: {
    alignSelf: 'center',
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    color: colors.accent.goldText,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
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
