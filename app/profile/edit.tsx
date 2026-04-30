import { Stack, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { Avatar } from '@/components/ui/Avatar';
import { FormField } from '@/components/ui/FormField';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { SubHeader } from '@/components/ui/SubHeader';
import { getHebrewDateLabel } from '@/lib/hebcal';
import { useAuthStore } from '@/store/useAuthStore';
import { colors } from '@/theme/colors';

const profileHref = '/profile' as Href;
const tribes = ['Коэн', 'Леви', 'Исраэль'] as const;
const maritalOptions = ['Холост', 'Женат', 'Замужем', 'Разведён/а', 'Вдов/а'] as const;
const privacyOptions = ['Только раввин', 'Все участники', 'Публично'] as const;

type BirthDateParseResult = {
  date: Date | null;
  error: string | null;
  iso: string | null;
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatIsoDateForUi(value: string | null | undefined): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return '';
  }

  return `${match[3]}.${match[2]}.${match[1]}`;
}

function formatDatePartsToIso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  );
}

function parseBirthDateInput(value: string): BirthDateParseResult {
  const text = value.trim();

  if (!text) {
    return { date: null, error: null, iso: null };
  }

  const ruMatch = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!ruMatch && !isoMatch) {
    return {
      date: null,
      error: 'Введите дату рождения в формате ДД.ММ.ГГГГ.',
      iso: null,
    };
  }

  const day = Number(ruMatch?.[1] ?? isoMatch?.[3]);
  const month = Number(ruMatch?.[2] ?? isoMatch?.[2]);
  const year = Number(ruMatch?.[3] ?? isoMatch?.[1]);

  if (year < 1900 || !isRealDate(year, month, day)) {
    return {
      date: null,
      error: 'Проверьте дату рождения.',
      iso: null,
    };
  }

  const date = new Date(year, month - 1, day);
  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (date.getTime() > todayDate.getTime()) {
    return {
      date: null,
      error: 'Дата рождения не может быть в будущем.',
      iso: null,
    };
  }

  return {
    date,
    error: null,
    iso: formatDatePartsToIso(year, month, day),
  };
}

function trimOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildFullName(firstName: string, lastName: string): string | null {
  return [firstName, lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ') || null;
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
  options: readonly T[];
  value: T;
}) {
  return (
    <View style={styles.pillWrap}>
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable
            disabled={disabled}
            key={option}
            onPress={() => onChange(option)}
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
              {option}
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
  const updateProfile = useAuthStore((state) => state.updateProfile);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [hebrewName, setHebrewName] = useState('');
  const [dob, setDob] = useState('');
  const [tribe, setTribe] = useState<(typeof tribes)[number]>('Исраэль');
  const [marital, setMarital] = useState<(typeof maritalOptions)[number]>('Холост');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [about, setAbout] = useState('');
  const [privacyBirthday, setPrivacyBirthday] = useState<(typeof privacyOptions)[number]>('Все участники');
  const [privacyPhone, setPrivacyPhone] = useState<(typeof privacyOptions)[number]>('Только раввин');
  const [privacyProfile, setPrivacyProfile] = useState<(typeof privacyOptions)[number]>('Все участники');
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fullName = useMemo(() => buildFullName(firstName, lastName), [firstName, lastName]);
  const avatarName = fullName ?? email.trim() ?? user?.email ?? 'СС';
  const birthDateResult = useMemo(() => parseBirthDateInput(dob), [dob]);
  const birthDateError = dob.trim() ? birthDateResult.error : null;
  const hebrewDateLabel = useMemo(() => {
    if (birthDateResult.date) {
      return getHebrewDateLabel(birthDateResult.date);
    }

    return birthDateError ? 'Проверьте гражданскую дату' : 'Будет рассчитано позже';
  }, [birthDateError, birthDateResult.date]);

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
    setPhone(profile?.phone ?? '');
    setEmail(profile?.email ?? user?.email ?? '');
    setCity(profile?.city ?? '');
  }, [
    profile?.birth_date,
    profile?.city,
    profile?.email,
    profile?.first_name,
    profile?.hebrew_name,
    profile?.last_name,
    profile?.phone,
    user?.email,
  ]);

  const handleReloadProfile = useCallback(() => {
    setLocalError(null);
    void loadSession().catch((error) => {
      setLocalError(error instanceof Error ? error.message : 'Не удалось загрузить профиль.');
    });
  }, [loadSession]);

  const handlePhotoPlaceholder = useCallback(() => {
    Alert.alert('Фото профиля', 'Загрузка фото будет добавлена следующим этапом.');
  }, []);

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

    const nextFullName = buildFullName(firstName, lastName);

    setIsSaving(true);

    try {
      await updateProfile({
        birth_date: birthDateResult.iso,
        city: trimOrNull(city),
        display_name: nextFullName,
        email: trimOrNull(email),
        first_name: trimOrNull(firstName),
        full_name: nextFullName,
        hebrew_name: trimOrNull(hebrewName),
        last_name: trimOrNull(lastName),
        phone: trimOrNull(phone),
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
    birthDateResult.error,
    birthDateResult.iso,
    city,
    email,
    firstName,
    hebrewName,
    lastName,
    phone,
    profile,
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
            <Avatar initials={getInitials(avatarName)} size={80} />
            <Pressable onPress={handlePhotoPlaceholder} style={styles.cameraBadge}>
              <Text style={styles.cameraText}>📷</Text>
            </Pressable>
          </View>
          <View style={styles.flex}>
            <Text style={styles.photoTitle}>Фото профиля</Text>
            <Text style={styles.photoText}>Видно участникам общины{'\n'}Рекомендуем 400×400 px</Text>
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
          <FormField label="Гражданская дата" value={dob} onChangeText={setDob} placeholder="ДД.ММ.ГГГГ" />
          {birthDateError ? <Text style={styles.fieldError}>{birthDateError}</Text> : null}
          <View style={styles.hebrewDate}>
            <Text style={styles.tipEmoji}>✡️</Text>
            <View style={styles.flex}>
              <Text style={styles.goldOverline}>ЕВРЕЙСКАЯ ДАТА</Text>
              <Text style={styles.goldTitle}>{hebrewDateLabel}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <SectionTitle title="ПРОИСХОЖДЕНИЕ" />
          <SelectPill disabled options={tribes} value={tribe} onChange={setTribe} />
          <Text style={styles.helper}>Раздел будет сохранён после добавления колонок профиля.</Text>
        </View>

        <View style={styles.section}>
          <SectionTitle title="СЕМЕЙНОЕ ПОЛОЖЕНИЕ" />
          <SelectPill disabled options={maritalOptions} value={marital} onChange={setMarital} />
          <Text style={styles.helper}>Раздел будет сохранён после добавления колонок профиля.</Text>
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
            editable={false}
            label="Несколько слов о себе"
            value={about}
            onChangeText={setAbout}
            placeholder="Будет добавлено позже"
            multiline
          />
          <Text style={styles.counter}>{about.length} / 200</Text>
        </View>

        <View style={styles.section}>
          <SectionTitle title="ПРИВАТНОСТЬ" />
          <GlassCard>
            <Text style={styles.privacyLabel}>Профиль виден</Text>
            <SelectPill disabled options={privacyOptions} value={privacyProfile} onChange={setPrivacyProfile} />
            <Text style={styles.privacyLabel}>День рождения виден</Text>
            <SelectPill disabled options={privacyOptions} value={privacyBirthday} onChange={setPrivacyBirthday} />
            <Text style={styles.privacyLabel}>Телефон виден</Text>
            <SelectPill disabled options={privacyOptions} value={privacyPhone} onChange={setPrivacyPhone} />
            <Text style={styles.helper}>Настройки приватности будут сохранены после добавления колонок профиля.</Text>
          </GlassCard>
        </View>

        {localError ? <Text style={styles.errorText}>{localError}</Text> : null}

        <PrimaryButton
          disabled={isSaving}
          title={isSaving ? 'Сохраняем...' : 'Сохранить изменения'}
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
