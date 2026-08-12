import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { ApiClientError } from '@/services/apiClient';
import {
  confirmPrivacyAccessCode,
  confirmPrivacyErasure,
  createDeletionPrivacyRequest,
  requestPrivacyAccessCode,
} from '@/services/privacyService';
import { colors } from '@/theme/colors';

type DeleteAccountStep = 'explanation' | 'verification' | 'confirmation' | 'manual_review' | 'success';

type DeleteAccountFlowProps = {
  accountEmail: string;
  onCancel: () => void;
  onDeletionPending: () => Promise<void>;
};

const PRIVACY_SESSION_ERROR_CODES = new Set([
  'privacy_session_required',
  'privacy_session_expired',
  'privacy_session_revoked',
]);

function errorCode(error: unknown): string | null {
  return error instanceof ApiClientError ? error.code : null;
}

function isNetworkError(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'network_error' || code === 'request_timeout';
}

type FlowButtonProps = {
  accessibilityLabel: string;
  destructive?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
  title: string;
};

function FlowButton({
  accessibilityLabel,
  destructive = false,
  disabled = false,
  loading = false,
  onPress,
  title,
}: FlowButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityLabel={loading ? `${accessibilityLabel}. Выполняется.` : accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        destructive ? styles.destructiveButton : styles.standardButton,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
      ]}
    >
      {loading ? <ActivityIndicator color={colors.text} size="small" /> : null}
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

export function DeleteAccountFlow({
  accountEmail,
  onCancel,
  onDeletionPending,
}: DeleteAccountFlowProps) {
  const [step, setStep] = useState<DeleteAccountStep>('explanation');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isRequestingCode, setIsRequestingCode] = useState(false);
  const [isConfirmingCode, setIsConfirmingCode] = useState(false);
  const [isConfirmingDeletion, setIsConfirmingDeletion] = useState(false);
  const codeInputRef = useRef<TextInput>(null);
  const privacySessionTokenRef = useRef<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const codeRequestActiveRef = useRef(false);
  const codeConfirmationActiveRef = useRef(false);
  const deletionConfirmationActiveRef = useRef(false);
  const destructiveAlertOpenRef = useRef(false);
  const normalizedAccountEmail = accountEmail.trim();

  useEffect(() => {
    if (step !== 'verification') {
      return;
    }

    const focusTimer = setTimeout(() => codeInputRef.current?.focus(), 100);

    return () => clearTimeout(focusTimer);
  }, [step]);

  useEffect(() => {
    if (error) {
      AccessibilityInfo.announceForAccessibility(error);
    }
  }, [error]);

  useEffect(() => () => {
    privacySessionTokenRef.current = null;
    requestIdRef.current = null;
  }, []);

  const requestCode = useCallback(async () => {
    if (
      codeRequestActiveRef.current
      || codeConfirmationActiveRef.current
      || !normalizedAccountEmail
    ) {
      return;
    }

    codeRequestActiveRef.current = true;
    setIsRequestingCode(true);
    setError(null);

    try {
      await requestPrivacyAccessCode(normalizedAccountEmail);
      setCode('');
      setStep('verification');
    } catch (requestError) {
      setError(isNetworkError(requestError)
        ? 'Не удалось выполнить запрос. Проверьте соединение и попробуйте снова.'
        : 'Не удалось запросить код. Попробуйте ещё раз.');
    } finally {
      codeRequestActiveRef.current = false;
      setIsRequestingCode(false);
    }
  }, [normalizedAccountEmail]);

  const confirmCode = useCallback(async () => {
    if (
      codeConfirmationActiveRef.current
      || codeRequestActiveRef.current
      || !/^\d{6}$/.test(code)
    ) {
      return;
    }

    codeConfirmationActiveRef.current = true;
    setIsConfirmingCode(true);
    setError(null);

    try {
      const privacySession = await confirmPrivacyAccessCode(normalizedAccountEmail, code);
      privacySessionTokenRef.current = privacySession.privacySessionToken;
      setCode('');
      setStep('confirmation');
    } catch (confirmationError) {
      setError(errorCode(confirmationError) === 'invalid_or_expired_privacy_code'
        ? 'Неверный или просроченный код.'
        : (isNetworkError(confirmationError)
          ? 'Не удалось выполнить запрос. Проверьте соединение и попробуйте снова.'
          : 'Не удалось подтвердить код. Попробуйте ещё раз.'));
    } finally {
      codeConfirmationActiveRef.current = false;
      setIsConfirmingCode(false);
    }
  }, [code, normalizedAccountEmail]);

  const returnToVerificationAfterExpiredSession = useCallback(() => {
    privacySessionTokenRef.current = null;
    setCode('');
    setStep('verification');
    setError('Сеанс подтверждения истёк. Получите новый код и попробуйте снова.');
  }, []);

  const submitDeletion = useCallback(async () => {
    const privacySessionToken = privacySessionTokenRef.current;

    if (deletionConfirmationActiveRef.current || !privacySessionToken) {
      if (!privacySessionToken) {
        returnToVerificationAfterExpiredSession();
      }
      return;
    }

    deletionConfirmationActiveRef.current = true;
    setIsConfirmingDeletion(true);
    setError(null);

    try {
      let requestId = requestIdRef.current;

      if (!requestId) {
        const privacyRequest = await createDeletionPrivacyRequest(privacySessionToken);
        requestId = privacyRequest.id;
        requestIdRef.current = requestId;
      }

      const lifecycle = await confirmPrivacyErasure(requestId, privacySessionToken);

      if (lifecycle.state !== 'deletion_pending') {
        throw new Error('Unexpected privacy erasure lifecycle state.');
      }

      privacySessionTokenRef.current = null;
      setStep('success');
      Alert.alert(
        'Запрос на удаление подтверждён',
        'Доступ к аккаунту остановлен. Удаление данных будет завершено в соответствии с правилами хранения данных. После завершения вы получите уведомление на email.',
      );
      await onDeletionPending();
    } catch (deletionError) {
      const codeValue = errorCode(deletionError);

      if (codeValue === 'privacy_erasure_manual_review_required') {
        setStep('manual_review');
        setError(null);
      } else if (codeValue && PRIVACY_SESSION_ERROR_CODES.has(codeValue)) {
        returnToVerificationAfterExpiredSession();
      } else {
        setError(isNetworkError(deletionError)
          ? 'Не удалось выполнить запрос. Проверьте соединение и попробуйте снова.'
          : 'Не удалось подтвердить удаление аккаунта. Попробуйте ещё раз.');
      }
    } finally {
      deletionConfirmationActiveRef.current = false;
      setIsConfirmingDeletion(false);
    }
  }, [onDeletionPending, returnToVerificationAfterExpiredSession]);

  const showDestructiveConfirmation = useCallback(() => {
    if (destructiveAlertOpenRef.current || isConfirmingDeletion) {
      return;
    }

    destructiveAlertOpenRef.current = true;
    Alert.alert(
      'Удалить аккаунт?',
      'После подтверждения вы потеряете доступ к аккаунту.',
      [
        {
          text: 'Отмена',
          style: 'cancel',
          onPress: () => {
            destructiveAlertOpenRef.current = false;
          },
        },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            destructiveAlertOpenRef.current = false;
            void submitDeletion();
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          destructiveAlertOpenRef.current = false;
        },
      },
    );
  }, [isConfirmingDeletion, submitDeletion]);

  const handleCodeChange = useCallback((value: string) => {
    setCode(value.replace(/\D/g, '').slice(0, 6));
    setError(null);
  }, []);

  const renderError = () => error ? (
    <Text
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
      style={styles.errorText}
    >
      {error}
    </Text>
  ) : null;

  if (step === 'manual_review') {
    return (
      <GlassCard accessibilityLabel="Требуется дополнительная обработка">
        <View style={styles.content}>
          <Text style={styles.title}>Требуется дополнительная обработка</Text>
          <Text style={styles.body}>
            Запрос на удаление получен, но его нельзя завершить автоматически. Он требует ручной обработки. Доступ к вашему аккаунту пока сохранён.
          </Text>
          <FlowButton
            accessibilityLabel="Вернуться в аккаунт без выхода"
            onPress={onCancel}
            title="Вернуться в аккаунт"
          />
        </View>
      </GlassCard>
    );
  }

  if (step === 'success') {
    return (
      <GlassCard accessibilityLabel="Запрос на удаление подтверждён">
        <View style={styles.content}>
          <Text style={styles.title}>Запрос на удаление подтверждён</Text>
          <Text style={styles.body}>
            Доступ к аккаунту остановлен. Удаление данных будет завершено в соответствии с правилами хранения данных. После завершения вы получите уведомление на email.
          </Text>
          <ActivityIndicator accessibilityLabel="Очищаем локальную сессию" color={colors.orange} />
        </View>
      </GlassCard>
    );
  }

  if (step === 'verification') {
    return (
      <GlassCard accessibilityLabel="Подтверждение удаления аккаунта">
        <View style={styles.content}>
          <Text style={styles.title}>Подтверждение удаления</Text>
          <Text style={styles.body}>Мы отправили шестизначный код на</Text>
          <Text selectable style={styles.email}>{normalizedAccountEmail}</Text>
          <View style={styles.field}>
            <Text nativeID="delete-account-code-label" style={styles.label}>Код подтверждения</Text>
            <TextInput
              ref={codeInputRef}
              accessibilityLabel="Код подтверждения удаления, шесть цифр"
              accessibilityLabelledBy="delete-account-code-label"
              autoComplete="one-time-code"
              editable={!isRequestingCode && !isConfirmingCode}
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={handleCodeChange}
              onSubmitEditing={() => {
                if (/^\d{6}$/.test(code) && !isRequestingCode && !isConfirmingCode) {
                  void confirmCode();
                }
              }}
              placeholder="_ _ _ _ _ _"
              placeholderTextColor={colors.textGhost}
              returnKeyType="done"
              selectionColor={colors.orange}
              style={styles.codeInput}
              textContentType="oneTimeCode"
              value={code}
            />
          </View>
          {renderError()}
          <FlowButton
            accessibilityLabel="Продолжить подтверждение удаления"
            disabled={!/^\d{6}$/.test(code) || isRequestingCode}
            loading={isConfirmingCode}
            onPress={() => void confirmCode()}
            title={isConfirmingCode ? 'Проверяем код...' : 'Продолжить'}
          />
          <Pressable
            accessibilityLabel={isRequestingCode ? 'Отправляем код ещё раз' : 'Отправить код ещё раз'}
            accessibilityRole="button"
            accessibilityState={{
              busy: isRequestingCode,
              disabled: isRequestingCode || isConfirmingCode,
            }}
            disabled={isRequestingCode || isConfirmingCode}
            onPress={() => void requestCode()}
            style={({ pressed }) => [styles.linkButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.linkText}>
              {isRequestingCode ? 'Отправляем код...' : 'Отправить код ещё раз'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Отменить удаление аккаунта"
            accessibilityRole="button"
            disabled={isRequestingCode || isConfirmingCode}
            onPress={onCancel}
            style={({ pressed }) => [styles.linkButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.cancelText}>Отмена</Text>
          </Pressable>
        </View>
      </GlassCard>
    );
  }

  if (step === 'confirmation') {
    return (
      <GlassCard accessibilityLabel="Финальное подтверждение удаления аккаунта">
        <View style={styles.content}>
          <Text style={styles.title}>Подтвердите удаление аккаунта</Text>
          <Text style={styles.body}>
            После подтверждения доступ к аккаунту будет остановлен. Это действие предназначено для удаления аккаунта, а не для обычного выхода. Если часть данных требует обязательного хранения или ручной проверки, сервер остановит автоматическое удаление и сообщит об этом.
          </Text>
          {renderError()}
          <FlowButton
            accessibilityLabel="Удалить аккаунт. Необратимое действие после обработки запроса"
            destructive
            loading={isConfirmingDeletion}
            onPress={showDestructiveConfirmation}
            title={isConfirmingDeletion ? 'Подтверждаем удаление...' : 'Удалить аккаунт'}
          />
          <Pressable
            accessibilityLabel="Отменить удаление аккаунта"
            accessibilityRole="button"
            disabled={isConfirmingDeletion}
            onPress={onCancel}
            style={({ pressed }) => [styles.linkButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.cancelText}>Отмена</Text>
          </Pressable>
        </View>
      </GlassCard>
    );
  }

  return (
    <GlassCard accessibilityLabel="Удаление аккаунта">
      <View style={styles.content}>
        <Text style={styles.title}>Удаление аккаунта</Text>
        <Text style={styles.body}>
          После подтверждения доступ к аккаунту будет остановлен. Ваш запрос на удаление данных будет обработан в соответствии с правилами хранения данных. Некоторые сведения могут требовать отдельной обработки, если их нельзя удалить автоматически. Для подтверждения мы отправим код на email вашего аккаунта.
        </Text>
        <View style={styles.accountEmailBox}>
          <Text style={styles.label}>Email аккаунта</Text>
          <Text accessibilityLabel={`Email аккаунта: ${normalizedAccountEmail}`} selectable style={styles.email}>
            {normalizedAccountEmail || 'Email аккаунта недоступен'}
          </Text>
          <Text style={styles.readOnlyText}>Email используется только для подтверждения и не редактируется.</Text>
        </View>
        {renderError()}
        <FlowButton
          accessibilityLabel="Получить код подтверждения удаления"
          disabled={!normalizedAccountEmail}
          loading={isRequestingCode}
          onPress={() => void requestCode()}
          title={isRequestingCode ? 'Запрашиваем код...' : 'Получить код подтверждения'}
        />
        <Pressable
          accessibilityLabel="Отменить удаление аккаунта"
          accessibilityRole="button"
          disabled={isRequestingCode}
          onPress={onCancel}
          style={({ pressed }) => [styles.linkButton, pressed && styles.buttonPressed]}
        >
          <Text style={styles.cancelText}>Отмена</Text>
        </Pressable>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
  },
  title: {
    color: colors.danger,
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
  },
  accountEmailBox: {
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent.redBorder,
    backgroundColor: colors.glass.w05,
    padding: 14,
  },
  label: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  email: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
  },
  readOnlyText: {
    color: colors.textGhost,
    fontSize: 12,
    lineHeight: 17,
  },
  field: {
    gap: 7,
  },
  codeInput: {
    minHeight: 54,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent.redBorder,
    backgroundColor: colors.glass.w06,
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 8,
    paddingHorizontal: 16,
    textAlign: 'center',
  },
  button: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  standardButton: {
    borderColor: colors.accent.orangeBorder,
    backgroundColor: colors.orangeDark,
  },
  destructiveButton: {
    borderColor: colors.danger,
    backgroundColor: colors.red,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonPressed: {
    opacity: 0.78,
  },
  buttonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  linkButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  linkText: {
    color: colors.orange,
    fontSize: 14,
    fontWeight: '700',
  },
  cancelText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 19,
  },
});
