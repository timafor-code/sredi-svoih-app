import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/ui/FormField';
import { MINIMUM_PASSWORD_LENGTH } from '@/services/authValidation';
import { ApiClientError } from '@/services/apiClient';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useAuthStore } from '@/store/useAuthStore';
import { colors } from '@/theme/colors';
import type { ApiSignupLegalDocument } from '@/types/api';

import { AUTH_ERROR_MESSAGES, getAuthErrorMessage } from './authErrorMessages';
import { EmailVerificationCodeForm } from './EmailVerificationCodeForm';

type EmailSignUpFormProps = {
  initialEmail?: string;
  onEmailChange?: (email: string) => void;
  onSignedIn: () => Promise<void> | void;
  onSwitchToSignIn: (email?: string) => void;
};

function isHttpsDocumentUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

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
  const [legalDocuments, setLegalDocuments] = useState<ApiSignupLegalDocument[] | null>(null);
  const [privacyPolicy, setPrivacyPolicy] = useState<ApiSignupLegalDocument | null>(null);
  const [isLoadingLegalDocuments, setIsLoadingLegalDocuments] = useState(true);
  const [accountConsentAccepted, setAccountConsentAccepted] = useState(false);
  const [userAgreementAccepted, setUserAgreementAccepted] = useState(false);

  const signUpWithEmail = useAuthStore((state) => state.signUpWithEmail);

  const loadSignupLegalDocuments = useCallback(async () => {
    setIsLoadingLegalDocuments(true);
    setLegalDocuments(null);
    setPrivacyPolicy(null);
    setAccountConsentAccepted(false);
    setUserAgreementAccepted(false);

    try {
      const { getSignupLegalDocuments } = await import('@/services/authService');
      const response = await getSignupLegalDocuments();
      const documents = response.documents;
      const policy = response.privacy_policy;
      const hasRequiredDocuments = documents.length === 2
        && documents.some((document) => document.document_type === 'account_personal_data_consent')
        && documents.some((document) => document.document_type === 'user_agreement')
        && documents.every((document) => isHttpsDocumentUrl(document.published_url))
        && policy.document_type === 'privacy_policy'
        && isHttpsDocumentUrl(policy.published_url);

      if (!hasRequiredDocuments) {
        throw new Error('Документы для регистрации временно недоступны. Попробуйте ещё раз.');
      }

      setLegalDocuments(documents);
      setPrivacyPolicy(policy);
    } catch {
      setLegalDocuments(null);
      setPrivacyPolicy(null);
      setLocalError('Не удалось загрузить документы для регистрации. Создание аккаунта недоступно.');
    } finally {
      setIsLoadingLegalDocuments(false);
    }
  }, []);

  useEffect(() => {
    setEmail(initialEmail);
  }, [initialEmail]);

  useEffect(() => {
    void loadSignupLegalDocuments();
  }, [loadSignupLegalDocuments]);

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

    const accountConsentDocument = legalDocuments?.find(
      (document) => document.document_type === 'account_personal_data_consent',
    );
    const userAgreementDocument = legalDocuments?.find(
      (document) => document.document_type === 'user_agreement',
    );

    if (!accountConsentDocument || !userAgreementDocument || !privacyPolicy || isLoadingLegalDocuments) {
      setLocalError('Не удалось загрузить документы для регистрации. Создание аккаунта недоступно.');
      return;
    }

    if (!accountConsentAccepted || !userAgreementAccepted) {
      setLocalError('Для создания аккаунта необходимо принять оба документа.');
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await signUpWithEmail(normalizedEmail, password, {
        account_personal_data_consent: {
          document_id: accountConsentDocument.id,
          content_hash: accountConsentDocument.content_hash,
        },
        user_agreement: {
          document_id: userAgreementDocument.id,
          content_hash: userAgreementDocument.content_hash,
        },
      });

      if (result.needsEmailConfirmation) {
        setConfirmationEmail(normalizedEmail);
        onEmailChange?.(normalizedEmail);
        return;
      }

      setPassword('');
      setRepeatPassword('');
      await onSignedIn();
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'legal_documents_changed') {
        setLocalError('Документы обновились. Ознакомьтесь с новой версией и примите оба документа снова.');
        await loadSignupLegalDocuments();
        return;
      }

      setLocalError(getAuthErrorMessage(error, 'Не удалось создать аккаунт. Попробуйте ещё раз.'));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    accountConsentAccepted,
    email,
    isLoadingLegalDocuments,
    legalDocuments,
    loadSignupLegalDocuments,
    onEmailChange,
    onSignedIn,
    password,
    privacyPolicy,
    signUpWithEmail,
    userAgreementAccepted,
    validate,
  ]);

  const openDocument = useCallback(async (document: ApiSignupLegalDocument) => {
    if (!isHttpsDocumentUrl(document.published_url)) {
      setLocalError('Ссылка на документ недоступна.');
      return;
    }

    try {
      await Linking.openURL(document.published_url);
    } catch {
      setLocalError('Не удалось открыть документ. Попробуйте ещё раз.');
    }
  }, []);

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

  const accountConsentDocument = legalDocuments?.find(
    (document) => document.document_type === 'account_personal_data_consent',
  );
  const userAgreementDocument = legalDocuments?.find(
    (document) => document.document_type === 'user_agreement',
  );
  const canSubmit = Boolean(
    accountConsentDocument
    && userAgreementDocument
    && privacyPolicy
    && accountConsentAccepted
    && userAgreementAccepted
    && !isLoadingLegalDocuments
    && !isSubmitting,
  );

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
      <View style={styles.legalSection}>
        <Text style={styles.legalHeading}>Документы для создания аккаунта</Text>
        {isLoadingLegalDocuments ? (
          <Text accessibilityLiveRegion="polite" style={styles.legalStatus}>Загружаем документы…</Text>
        ) : null}
        {accountConsentDocument ? (
          <View style={styles.legalItem}>
            <Pressable
              accessibilityLabel="Согласие на обработку персональных данных для создания аккаунта"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: accountConsentAccepted, disabled: isSubmitting }}
              disabled={isSubmitting}
              onPress={() => setAccountConsentAccepted((value) => !value)}
              style={styles.checkboxRow}
            >
              <Ionicons
                color={accountConsentAccepted ? colors.orange : colors.textDim}
                name={accountConsentAccepted ? 'checkbox' : 'square-outline'}
                size={24}
              />
              <Text style={styles.legalText}>
                Я ознакомился(-ась) с документом и даю отдельное согласие на обработку персональных данных для создания аккаунта.
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel={`Открыть ${accountConsentDocument.title}, версия ${accountConsentDocument.version}`}
              accessibilityRole="link"
              onPress={() => void openDocument(accountConsentDocument)}
            >
              <Text style={styles.documentLink}>{accountConsentDocument.title} · версия {accountConsentDocument.version}</Text>
            </Pressable>
          </View>
        ) : null}
        {userAgreementDocument ? (
          <View style={styles.legalItem}>
            <Pressable
              accessibilityLabel="Пользовательское соглашение"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: userAgreementAccepted, disabled: isSubmitting }}
              disabled={isSubmitting}
              onPress={() => setUserAgreementAccepted((value) => !value)}
              style={styles.checkboxRow}
            >
              <Ionicons
                color={userAgreementAccepted ? colors.orange : colors.textDim}
                name={userAgreementAccepted ? 'checkbox' : 'square-outline'}
                size={24}
              />
              <Text style={styles.legalText}>Я принимаю Пользовательское соглашение.</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={`Открыть ${userAgreementDocument.title}, версия ${userAgreementDocument.version}`}
              accessibilityRole="link"
              onPress={() => void openDocument(userAgreementDocument)}
            >
              <Text style={styles.documentLink}>{userAgreementDocument.title} · версия {userAgreementDocument.version}</Text>
            </Pressable>
          </View>
        ) : null}
        {privacyPolicy ? (
          <Pressable
            accessibilityLabel={`Открыть ${privacyPolicy.title}, версия ${privacyPolicy.version}`}
            accessibilityRole="link"
            onPress={() => void openDocument(privacyPolicy)}
          >
            <Text style={styles.documentLink}>{privacyPolicy.title} · версия {privacyPolicy.version}</Text>
          </Pressable>
        ) : null}
      </View>
      <PrimaryButton
        title={isSubmitting ? 'Создаём...' : 'Создать аккаунт'}
        disabled={!canSubmit}
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
  legalSection: {
    gap: 10,
  },
  legalHeading: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '800',
  },
  legalStatus: {
    color: colors.textDim,
    fontSize: 12,
  },
  legalItem: {
    gap: 6,
  },
  checkboxRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8,
  },
  legalText: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  documentLink: {
    color: colors.orange,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    marginLeft: 32,
    textDecorationLine: 'underline',
  },
});
