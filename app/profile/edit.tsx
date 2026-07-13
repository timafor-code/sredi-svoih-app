import { Stack, useFocusEffect, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { Avatar } from '@/components/ui/Avatar';
import { FormField } from '@/components/ui/FormField';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { SubHeader } from '@/components/ui/SubHeader';
import {
  buildHebrewBirthDateProfile,
  formatBirthDateInput,
  formatIsoDateForUi,
  parseBirthDateInput,
} from '@/lib/profileDates';
import {
  deleteCurrentUserAvatar,
  isApiAvatarProviderEnabled,
  uploadProfileAvatar,
} from '@/services/avatarService';
import { useAuthStore } from '@/store/useAuthStore';
import { colors } from '@/theme/colors';
import {
  DEFAULT_BIRTHDAY_VISIBILITY,
  DEFAULT_PHONE_VISIBILITY,
  DEFAULT_PROFILE_VISIBILITY,
  PROFILE_BIRTH_TIME_CONTEXT_LABELS,
  isProfileBirthTimeContext,
  isProfileMaritalStatus,
  isProfileTribeStatus,
  isProfileVisibility,
  type ProfileBirthTimeContext,
  type ProfileMaritalStatus,
  type ProfileTribeStatus,
  type ProfileVisibility,
} from '@/types/profile';

const profileHref = '/profile' as Href;
const ABOUT_MAX_LENGTH = 200;

type SelectOption<T extends string> = {
  label: string;
  value: T;
};

const tribeOptions: readonly SelectOption<ProfileTribeStatus>[] = [
  { label: 'Коэн', value: 'kohen' },
  { label: 'Леви', value: 'levi' },
  { label: 'Исраэль', value: 'israel' },
] as const;

const maritalOptions: readonly SelectOption<ProfileMaritalStatus>[] = [
  { label: 'Холост/не замужем', value: 'single' },
  { label: 'Женат/замужем', value: 'married' },
  { label: 'Разведён/а', value: 'divorced' },
  { label: 'Вдовец/вдова', value: 'widowed' },
  { label: 'Другое', value: 'other' },
] as const;

const privacyOptions: readonly SelectOption<ProfileVisibility>[] = [
  { label: 'Только раввин', value: 'rabbi_only' },
  { label: 'Все участники', value: 'members' },
  { label: 'Публично', value: 'public' },
] as const;

const birthTimeContextOptions: readonly SelectOption<ProfileBirthTimeContext>[] = [
  { label: PROFILE_BIRTH_TIME_CONTEXT_LABELS.before_sunset, value: 'before_sunset' },
  { label: PROFILE_BIRTH_TIME_CONTEXT_LABELS.after_sunset, value: 'after_sunset' },
  { label: PROFILE_BIRTH_TIME_CONTEXT_LABELS.unknown, value: 'unknown' },
] as const;

function trimOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeVisibility(
  value: ProfileVisibility | null | undefined,
  fallback: ProfileVisibility,
): ProfileVisibility {
  return isProfileVisibility(value) ? value : fallback;
}

function buildFullName(firstName: string, lastName: string): string | null {
  return [firstName, lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ') || null;
}

function getAvatarUploadErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Не удалось загрузить фото.';

  if (message === 'Auth required') {
    return 'Чтобы загрузить фото, войдите в приложение.';
  }

  return message;
}

function getAvatarDeleteErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Не удалось удалить фото.';

  if (message === 'Auth required') {
    return 'Чтобы удалить фото, войдите в приложение.';
  }

  return message;
}

function addAvatarCacheBuster(url: string): string {
  const separator = url.includes('?') ? '&' : '?';

  return `${url}${separator}v=${Date.now()}`;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'СС';
}

function SelectPill<T extends string>({
  disabled = false,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  onChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  value: T | null;
}) {
  return (
    <View style={styles.pillWrap}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            disabled={disabled}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[
              styles.selectPill,
              active && styles.selectPillActive,
              disabled && styles.selectPillDisabled,
            ]}
          >
            <Text
              style={[
                styles.selectPillText,
                active && styles.selectPillTextActive,
                disabled && styles.selectPillTextDisabled,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function EditProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const loading = useAuthStore((state) => state.loading);
  const loadSession = useAuthStore((state) => state.loadSession);
  const refreshProfileAvatar = useAuthStore((state) => state.refreshProfileAvatar);
  const setProfileAvatarUrl = useAuthStore((state) => state.setProfileAvatarUrl);
  const updateProfile = useAuthStore((state) => state.updateProfile);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [hebrewName, setHebrewName] = useState('');
  const [dob, setDob] = useState('');
  const [birthTimeContext, setBirthTimeContext] = useState<ProfileBirthTimeContext>('unknown');
  const [tribe, setTribe] = useState<ProfileTribeStatus | null>(null);
  const [marital, setMarital] = useState<ProfileMaritalStatus | null>(null);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [about, setAbout] = useState('');
  const [privacyBirthday, setPrivacyBirthday] = useState<ProfileVisibility>(DEFAULT_BIRTHDAY_VISIBILITY);
  const [privacyPhone, setPrivacyPhone] = useState<ProfileVisibility>(DEFAULT_PHONE_VISIBILITY);
  const [privacyProfile, setPrivacyProfile] = useState<ProfileVisibility>(DEFAULT_PROFILE_VISIBILITY);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isDeletingAvatar, setIsDeletingAvatar] = useState(false);
  const [localAvatarUrl, setLocalAvatarUrl] = useState<string | null>(null);

  const isApiAvatarProvider = isApiAvatarProviderEnabled();
  const isAvatarActionRunning = isUploadingAvatar || isDeletingAvatar;
  const fullName = useMemo(() => buildFullName(firstName, lastName), [firstName, lastName]);
  const avatarName = fullName ?? email.trim() ?? user?.email ?? 'СС';
  const birthDateResult = useMemo(() => parseBirthDateInput(dob), [dob]);
  const birthDateHelper = dob.trim() && !birthDateResult.isComplete ? birthDateResult.error : null;
  const birthDateError = dob.trim() && birthDateResult.isComplete ? birthDateResult.error : null;
  const hebrewBirthDate = useMemo(() => {
    if (!birthDateResult.date) {
      return null;
    }

    return buildHebrewBirthDateProfile(birthDateResult.date, birthTimeContext);
  }, [birthDateResult.date, birthTimeContext]);
  const hebrewDateLabel = useMemo(() => {
    if (hebrewBirthDate) {
      return hebrewBirthDate.labelRu;
    }

    return birthDateError ? 'Проверьте гражданскую дату' : 'Будет рассчитано позже';
  }, [birthDateError, hebrewBirthDate]);
  const hebrewDateNotice = useMemo(() => {
    if (birthTimeContext === 'after_sunset') {
      return 'Рассчитано как дата после захода солнца.';
    }

    if (birthTimeContext === 'unknown') {
      return 'Если вы родились после захода солнца, еврейская дата может быть следующей.';
    }

    return null;
  }, [birthTimeContext]);
  const aboutTooLong = about.length > ABOUT_MAX_LENGTH;
  const displayAvatarUrl = localAvatarUrl ?? profile?.avatar_url ?? null;

  useEffect(() => {
    if (user) {
      return;
    }

    void loadSession().catch((error) => {
      setLocalError(error instanceof Error ? error.message : 'Не удалось загрузить профиль.');
    });
  }, [loadSession, user]);

  useEffect(() => {
    setFirstName(profile?.first_name ?? '');
    setLastName(profile?.last_name ?? '');
    setHebrewName(profile?.hebrew_name ?? '');
    setDob(formatIsoDateForUi(profile?.birth_date));
    setBirthTimeContext(
      isProfileBirthTimeContext(profile?.birth_time_context) ? profile.birth_time_context : 'unknown',
    );
    setPhone(profile?.phone ?? '');
    setEmail(profile?.email ?? user?.email ?? '');
    setCity(profile?.city ?? '');
    setTribe(isProfileTribeStatus(profile?.tribe_status) ? profile.tribe_status : null);
    setMarital(isProfileMaritalStatus(profile?.marital_status) ? profile.marital_status : null);
    setAbout(profile?.about ?? '');
    setPrivacyProfile(normalizeVisibility(profile?.profile_visibility, DEFAULT_PROFILE_VISIBILITY));
    setPrivacyBirthday(normalizeVisibility(profile?.birthday_visibility, DEFAULT_BIRTHDAY_VISIBILITY));
    setPrivacyPhone(normalizeVisibility(profile?.phone_visibility, DEFAULT_PHONE_VISIBILITY));
  }, [
    profile?.about,
    profile?.birth_date,
    profile?.birth_time_context,
    profile?.birthday_visibility,
    profile?.city,
    profile?.email,
    profile?.first_name,
    profile?.hebrew_name,
    profile?.last_name,
    profile?.marital_status,
    profile?.phone,
    profile?.phone_visibility,
    profile?.profile_visibility,
    profile?.tribe_status,
    user?.email,
  ]);

  useEffect(() => {
    setLocalAvatarUrl(null);
  }, [profile?.avatar_url]);

  useFocusEffect(
    useCallback(() => {
      if (!user || !isApiAvatarProvider) {
        return undefined;
      }

      void refreshProfileAvatar();

      return undefined;
    }, [isApiAvatarProvider, refreshProfileAvatar, user]),
  );

  const handleReloadProfile = useCallback(() => {
    setLocalError(null);
    void loadSession().catch((error) => {
      setLocalError(error instanceof Error ? error.message : 'Не удалось загрузить профиль.');
    });
  }, [loadSession]);

  const handleDobChange = useCallback((value: string) => {
    const formatted = formatBirthDateInput(value);
    const wasDeletingSeparator = value.length < dob.length
      && dob.endsWith('.')
      && value.replace(/\D/g, '') === dob.replace(/\D/g, '');

    setDob(wasDeletingSeparator ? formatted.replace(/\.$/, '') : formatted);
  }, [dob]);

  const handlePickAvatar = useCallback(async () => {
    setLocalError(null);

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          'Нет доступа к фото',
          'Разрешите доступ к фотографиям в настройках устройства, чтобы выбрать аватар.',
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        allowsMultipleSelection: false,
        aspect: [1, 1],
        base64: true,
        mediaTypes: ['images'],
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        quality: 0.85,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];

      if (!asset?.uri) {
        return;
      }

      setIsUploadingAvatar(true);

      const uploadedAvatarUrl = await uploadProfileAvatar({
        base64: asset.base64,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        uri: asset.uri,
      });

      const avatarUrl = isApiAvatarProvider
        ? uploadedAvatarUrl
        : addAvatarCacheBuster(uploadedAvatarUrl);

      if (isApiAvatarProvider) {
        setProfileAvatarUrl(avatarUrl);
      } else {
        await updateProfile({ avatar_url: avatarUrl });
      }

      setLocalAvatarUrl(avatarUrl);
    } catch (error) {
      const message = getAvatarUploadErrorMessage(error);

      setLocalError(message);
      Alert.alert('Не удалось загрузить фото', message);
    } finally {
      setIsUploadingAvatar(false);
    }
  }, [isApiAvatarProvider, setProfileAvatarUrl, updateProfile]);

  const performDeleteAvatar = useCallback(async () => {
    setLocalError(null);
    setIsDeletingAvatar(true);

    try {
      await deleteCurrentUserAvatar();

      if (isApiAvatarProvider) {
        setProfileAvatarUrl(null);
      } else {
        await updateProfile({ avatar_url: null });
      }

      setLocalAvatarUrl(null);
    } catch (error) {
      const message = getAvatarDeleteErrorMessage(error);

      setLocalError(message);
      Alert.alert('Не удалось удалить фото', message);
    } finally {
      setIsDeletingAvatar(false);
    }
  }, [isApiAvatarProvider, setProfileAvatarUrl, updateProfile]);

  const handleDeleteAvatar = useCallback(() => {
    Alert.alert(
      'Удалить фото?',
      'Фото профиля будет удалено, вместо него будут показаны инициалы.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          onPress: () => {
            void performDeleteAvatar();
          },
          style: 'destructive',
        },
      ],
    );
  }, [performDeleteAvatar]);

  const handleDeletePlaceholder = useCallback(() => {
    Alert.alert('Удаление аккаунта', 'Удаление аккаунта будет добавлено следующим этапом.');
  }, []);

  const handleSave = useCallback(async () => {
    setLocalError(null);

    if (!user || !profile) {
      setLocalError('Профиль не загружен.');
      return;
    }

    if (birthDateResult.error) {
      setLocalError(birthDateResult.error);
      Alert.alert('Проверьте дату', birthDateResult.error);
      return;
    }

    if (aboutTooLong) {
      const message = `О себе: максимум ${ABOUT_MAX_LENGTH} символов. Сейчас ${about.length}.`;

      setLocalError(message);
      Alert.alert('Проверьте текст', message);
      return;
    }

    const nextFullName = buildFullName(firstName, lastName);

    setIsSaving(true);

    try {
      await updateProfile({
        about: trimOrNull(about),
        birth_date: birthDateResult.iso,
        birth_time_context: birthTimeContext,
        birthday_visibility: privacyBirthday,
        city: trimOrNull(city),
        display_name: nextFullName,
        email: trimOrNull(email),
        first_name: trimOrNull(firstName),
        full_name: nextFullName,
        hebrew_birth_date: hebrewBirthDate,
        hebrew_name: trimOrNull(hebrewName),
        last_name: trimOrNull(lastName),
        marital_status: marital,
        phone: trimOrNull(phone),
        phone_visibility: privacyPhone,
        profile_visibility: privacyProfile,
        tribe_status: tribe,
      });

      Alert.alert('Сохранено', 'Профиль обновлён.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось сохранить профиль.';

      setLocalError(message);
      Alert.alert('Не удалось сохранить', message);
    } finally {
      setIsSaving(false);
    }
  }, [
    about,
    aboutTooLong,
    birthDateResult.error,
    birthDateResult.iso,
    birthTimeContext,
    city,
    email,
    firstName,
    hebrewBirthDate,
    hebrewName,
    lastName,
    marital,
    phone,
    privacyBirthday,
    privacyPhone,
    privacyProfile,
    profile,
    tribe,
    updateProfile,
    user,
  ]);

  if (!user || !profile) {
    const title = loading ? 'Загружаем профиль' : user ? 'Профиль не загружен' : 'Нужен вход';
    const text = user
      ? 'Не удалось получить данные профиля. Попробуйте загрузить их ещё раз.'
      : 'Войдите в приложение, чтобы редактировать профиль.';

    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <Screen contentContainerStyle={{ gap: 20 }}>
          <SubHeader title="Редактировать профиль" />
          <GlassCard>
            <View style={styles.stateCard}>
              <Text style={styles.cardTitle}>{title}</Text>
              <Text style={styles.cardText}>{text}</Text>
              {localError ? <Text style={styles.errorText}>{localError}</Text> : null}
              {user ? (
                <PrimaryButton
                  disabled={loading}
                  onPress={handleReloadProfile}
                  title={loading ? 'Загружаем...' : 'Загрузить профиль'}
                />
              ) : (
                <PrimaryButton onPress={() => router.replace(profileHref)} title="К профилю" />
              )}
            </View>
          </GlassCard>
        </Screen>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen contentContainerStyle={{ gap: 20 }}>
        <SubHeader title="Редактировать профиль" />

        <View style={styles.avatarRow}>
          <View style={styles.avatarWrap}>
            <Avatar initials={getInitials(avatarName)} size={80} uri={displayAvatarUrl} />
            <Pressable
              disabled={isSaving || isAvatarActionRunning}
              onPress={handlePickAvatar}
              style={[
                styles.cameraBadge,
                (isSaving || isAvatarActionRunning) && styles.cameraBadgeDisabled,
              ]}
            >
              {isUploadingAvatar ? (
                <ActivityIndicator color={colors.text} size="small" />
              ) : (
                <Text style={styles.cameraText}>📷</Text>
              )}
            </Pressable>
          </View>
          <View style={styles.flex}>
            <Text style={styles.photoTitle}>Фото профиля</Text>
            <Text style={styles.photoText}>
              {isUploadingAvatar
                ? 'Загружаем фото...'
                : isDeletingAvatar
                  ? 'Удаляем фото...'
                  : 'Видно участникам общины\nРекомендуем 400×400 px'}
            </Text>
            <Pressable
              disabled={isSaving || isAvatarActionRunning}
              onPress={handleDeleteAvatar}
              style={[
                styles.photoDeleteButton,
                (isSaving || isAvatarActionRunning) && styles.photoDeleteButtonDisabled,
              ]}
            >
              <Text style={styles.photoDeleteText}>Удалить фото</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <SectionTitle title="ИМЯ" />
          <View style={styles.twoCols}>
            <View style={styles.flex}>
              <FormField label="Имя" value={firstName} onChangeText={setFirstName} />
            </View>
            <View style={styles.flex}>
              <FormField label="Фамилия" value={lastName} onChangeText={setLastName} />
            </View>
          </View>
          <FormField label="ЕВРЕЙСКОЕ ИМЯ (שם עברי)" value={hebrewName} onChangeText={setHebrewName} />
          <GlassCard>
            <View style={styles.tipRow}>
              <Text style={styles.tipEmoji}>💡</Text>
              <Text style={styles.tipText}>Еврейское имя используется в молитвенных записках и уведомлениях общины</Text>
            </View>
          </GlassCard>
        </View>

        <View style={styles.section}>
          <SectionTitle title="ДАТА РОЖДЕНИЯ" />
          <FormField
            label="Гражданская дата"
            value={dob}
            onChangeText={handleDobChange}
            placeholder="ДД.ММ.ГГГГ"
            keyboardType="number-pad"
            maxLength={10}
          />
          {birthDateHelper ? <Text style={styles.helper}>{birthDateHelper}</Text> : null}
          {birthDateError ? <Text style={styles.fieldError}>{birthDateError}</Text> : null}
          <Text style={styles.sectionHint}>
            Для еврейской даты важно, родились ли вы после захода солнца.
          </Text>
          <SelectPill
            options={birthTimeContextOptions}
            value={birthTimeContext}
            onChange={setBirthTimeContext}
          />
          <View style={styles.hebrewDate}>
            <Text style={styles.tipEmoji}>✡️</Text>
            <View style={styles.flex}>
              <Text style={styles.goldOverline}>ЕВРЕЙСКАЯ ДАТА</Text>
              <Text style={styles.goldTitle}>{hebrewDateLabel}</Text>
              {hebrewDateNotice ? (
                <Text
                  style={[
                    styles.goldHint,
                    birthTimeContext === 'unknown' && styles.goldWarning,
                  ]}
                >
                  {hebrewDateNotice}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <SectionTitle title="ПРОИСХОЖДЕНИЕ" />
          <SelectPill options={tribeOptions} value={tribe} onChange={setTribe} />
        </View>

        <View style={styles.section}>
          <SectionTitle title="СЕМЕЙНОЕ ПОЛОЖЕНИЕ" />
          <SelectPill options={maritalOptions} value={marital} onChange={setMarital} />
        </View>

        <View style={styles.section}>
          <SectionTitle title="КОНТАКТЫ" />
          <FormField label="Телефон" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <FormField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
          <FormField label="Город проживания" value={city} onChangeText={setCity} />
        </View>

        <View style={styles.section}>
          <SectionTitle title="О СЕБЕ" />
          <FormField
            label="Несколько слов о себе"
            value={about}
            onChangeText={setAbout}
            placeholder="Расскажите коротко о себе"
            multiline
          />
          <Text style={[styles.counter, aboutTooLong && styles.counterError]}>
            {about.length} / {ABOUT_MAX_LENGTH}
          </Text>
        </View>

        <View style={styles.section}>
          <SectionTitle title="ПРИВАТНОСТЬ" />
          <GlassCard>
            <Text style={styles.privacyLabel}>Профиль виден</Text>
            <SelectPill options={privacyOptions} value={privacyProfile} onChange={setPrivacyProfile} />
            <Text style={styles.privacyLabel}>День рождения виден</Text>
            <SelectPill options={privacyOptions} value={privacyBirthday} onChange={setPrivacyBirthday} />
            <Text style={styles.privacyLabel}>Телефон виден</Text>
            <SelectPill options={privacyOptions} value={privacyPhone} onChange={setPrivacyPhone} />
          </GlassCard>
        </View>

        {localError ? <Text style={styles.errorText}>{localError}</Text> : null}

        <PrimaryButton
          disabled={isSaving || isAvatarActionRunning}
          title={
            isUploadingAvatar
              ? 'Загружаем фото...'
              : isDeletingAvatar
                ? 'Удаляем фото...'
                : isSaving ? 'Сохраняем...' : 'Сохранить изменения'
          }
          buttonStyle={styles.saveButton}
          onPress={handleSave}
        />

        <Pressable onPress={handleDeletePlaceholder} style={styles.deleteButton}>
          <Text style={styles.deleteText}>Удалить аккаунт</Text>
        </Pressable>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarWrap: {
    position: 'relative',
  },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.orange,
    shadowColor: colors.orange,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  cameraText: {
    fontSize: 13,
  },
  cameraBadgeDisabled: {
    opacity: 0.65,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  photoTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  photoText: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  photoDeleteButton: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: 30,
    marginTop: 6,
  },
  photoDeleteButtonDisabled: {
    opacity: 0.5,
  },
  photoDeleteText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  stateCard: {
    gap: 12,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  cardText: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
  section: {
    gap: 10,
  },
  twoCols: {
    flexDirection: 'row',
    gap: 10,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tipEmoji: {
    fontSize: 18,
  },
  tipText: {
    flex: 1,
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 18,
  },
  sectionHint: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 18,
  },
  hebrewDate: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.15)',
    backgroundColor: 'rgba(255,200,50,0.07)',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  goldOverline: {
    color: colors.accent.goldTextDim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  goldTitle: {
    color: colors.accent.goldText,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 2,
  },
  goldHint: {
    color: colors.accent.goldTextDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  goldWarning: {
    color: colors.warning,
  },
  helper: {
    color: colors.textGhost,
    fontSize: 11,
    lineHeight: 17,
  },
  fieldError: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
  },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  selectPill: {
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w07,
    paddingHorizontal: 14,
  },
  selectPillActive: {
    borderColor: 'rgba(240,122,42,0.40)',
    backgroundColor: colors.orange,
    shadowColor: colors.orange,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  selectPillDisabled: {
    opacity: 0.5,
  },
  selectPillText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  selectPillTextActive: {
    color: colors.text,
  },
  selectPillTextDisabled: {
    color: colors.textDim,
  },
  counter: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 11,
    textAlign: 'right',
  },
  counterError: {
    color: colors.danger,
  },
  privacyLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 8,
  },
  saveButton: {
    minHeight: 48,
    borderRadius: 14,
  },
  deleteButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
  },
  deleteText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
});
