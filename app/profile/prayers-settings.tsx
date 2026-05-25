import { Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';

import { IOSGroup } from '@/components/ui/IOSGroup';
import { ListRow } from '@/components/ui/ListRow';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { SubHeader } from '@/components/ui/SubHeader';
import { ToggleRow } from '@/components/ui/ToggleRow';
import {
  getAvailableBlessingTextDisplayModes,
  normalizeDisplayModeForTextNusach,
} from '@/lib/blessingTextDisplayMode';
import { useAuthStore } from '@/store/useAuthStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { colors } from '@/theme/colors';
import type { BlessingTextDisplayMode, BlessingTextNusach } from '@/types/blessing';

type VisibleNusach = 'chabad' | 'sephardi';

const visibleNusachOptions: readonly {
  label: string;
  subtitle: string;
  value: VisibleNusach;
}[] = [
  { label: 'Хабад', subtitle: 'Теhилат hАшем / Хабад', value: 'chabad' },
  { label: 'Бейт Сфаради', subtitle: 'Сефардский порядок молитвы', value: 'sephardi' },
] as const;

const blessingDisplayModeLabels: Record<BlessingTextDisplayMode, string> = {
  he: 'Иврит',
  translit_ashkenaz: 'Транслит Ашкеназ',
  translit_sephard: 'Транслит Сефард',
  ru: 'Русский',
};

function isVisibleNusach(value: string | null | undefined): value is VisibleNusach {
  return value === 'chabad' || value === 'sephardi';
}

function getTextNusachForVisibleNusach(value: VisibleNusach): BlessingTextNusach {
  return value === 'sephardi' ? 'beit_sefaradi' : 'chabad';
}

export default function PrayersSettingsScreen() {
  const authUser = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const loading = useAuthStore((state) => state.loading);
  const loadSession = useAuthStore((state) => state.loadSession);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const blessingDefaultDisplayMode = useSettingsStore(
    (state) => state.blessingDefaultDisplayMode,
  );
  const setBlessingDefaultDisplayMode = useSettingsStore(
    (state) => state.setBlessingDefaultDisplayMode,
  );

  const [city, setCity] = useState('Москва');
  const [siddurLang, setSiddurLang] = useState('Русский');
  const [prayerReminder, setPrayerReminder] = useState(true);
  const [candleReminder, setCandleReminder] = useState(true);
  const [shabbatReminder, setShabbatReminder] = useState(true);
  const [holidayReminder, setHolidayReminder] = useState(false);
  const [sessionRequested, setSessionRequested] = useState(false);
  const [savingNusach, setSavingNusach] = useState<VisibleNusach | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const isSavingNusachRef = useRef(false);

  const savedNusach: VisibleNusach | null = isVisibleNusach(profile?.nusach) ? profile.nusach : null;
  const hasSavedVisibleNusach = savedNusach !== null;
  const selectedNusach: VisibleNusach = savedNusach ?? 'chabad';
  const selectedTextNusach = getTextNusachForVisibleNusach(selectedNusach);
  const availableBlessingDisplayModes = getAvailableBlessingTextDisplayModes(selectedTextNusach);
  const selectedBlessingDisplayMode = normalizeDisplayModeForTextNusach(
    blessingDefaultDisplayMode,
    selectedTextNusach,
  );

  useEffect(() => {
    if ((authUser && profile) || loading || sessionRequested) {
      return;
    }

    setSessionRequested(true);
    void loadSession().catch((error) => {
      setLocalError(error instanceof Error ? error.message : 'Не удалось загрузить профиль.');
    });
  }, [authUser, loadSession, loading, profile, sessionRequested]);

  useEffect(() => {
    if (selectedBlessingDisplayMode !== blessingDefaultDisplayMode) {
      setBlessingDefaultDisplayMode(selectedBlessingDisplayMode);
    }
  }, [
    blessingDefaultDisplayMode,
    selectedBlessingDisplayMode,
    setBlessingDefaultDisplayMode,
  ]);

  const handleNusachPress = useCallback(async (value: VisibleNusach) => {
    if (isSavingNusachRef.current || !authUser || !profile) {
      return;
    }

    setLocalError(null);
    setSavingNusach(value);
    isSavingNusachRef.current = true;

    try {
      await updateProfile({ nusach: value });
      const normalizedDisplayMode = normalizeDisplayModeForTextNusach(
        blessingDefaultDisplayMode,
        getTextNusachForVisibleNusach(value),
      );

      if (normalizedDisplayMode !== blessingDefaultDisplayMode) {
        setBlessingDefaultDisplayMode(normalizedDisplayMode);
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Не удалось сохранить нусах.');
    } finally {
      isSavingNusachRef.current = false;
      setSavingNusach(null);
    }
  }, [
    authUser,
    blessingDefaultDisplayMode,
    profile,
    setBlessingDefaultDisplayMode,
    updateProfile,
  ]);

  if (!authUser || !profile) {
    const isProfileLoading = loading || !sessionRequested;
    const title = isProfileLoading ? 'Загружаем профиль' : authUser ? 'Профиль не загружен' : 'Нужен вход';
    const text = authUser
      ? 'Откройте экран ещё раз, чтобы подтянуть настройки молитв.'
      : 'Войдите в профиль, чтобы сохранять нусах.';

    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <Screen contentContainerStyle={{ gap: 16 }}>
          <SubHeader title="Молитвы и календарь" subtitle="Город, нусах, язык сидура, напоминания" />
          <IOSGroup>
            <ListRow title={title} subtitle={text} isLast />
          </IOSGroup>
          {localError ? <Text style={{ color: colors.danger, fontSize: 12, lineHeight: 18 }}>{localError}</Text> : null}
        </Screen>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen contentContainerStyle={{ gap: 16 }}>
        <SubHeader title="Молитвы и календарь" subtitle="Город, нусах, язык сидура, напоминания" />

        <SectionTitle title="МЕСТОПОЛОЖЕНИЕ" />
        <IOSGroup>
          <ListRow icon="📍" title="Город" rightText={city} onPress={() => setCity(city === 'Москва' ? 'Санкт-Петербург' : 'Москва')} />
          <ListRow icon="🌍" title="Часовой пояс" rightText="Europe/Moscow" isLast />
        </IOSGroup>

        <SectionTitle title="НУСАХ" />
        <IOSGroup>
          {visibleNusachOptions.map((option, index) => (
            <ListRow
              key={option.value}
              title={option.label}
              subtitle={option.subtitle}
              rightText={savingNusach === option.value ? '...' : selectedNusach === option.value ? '✓' : undefined}
              onPress={savingNusach ? undefined : () => {
                void handleNusachPress(option.value);
              }}
              isLast={index === visibleNusachOptions.length - 1}
            />
          ))}
        </IOSGroup>
        {!hasSavedVisibleNusach ? (
          <Text style={{ color: colors.textDim, fontSize: 12, lineHeight: 18 }}>
            Показан Хабад по умолчанию. Нажмите вариант, чтобы сохранить нусах в профиле.
          </Text>
        ) : null}
        {savingNusach ? (
          <Text style={{ color: colors.textDim, fontSize: 12, lineHeight: 18 }}>
            Сохраняем нусах...
          </Text>
        ) : null}
        {localError ? <Text style={{ color: colors.danger, fontSize: 12, lineHeight: 18 }}>{localError}</Text> : null}

        <SectionTitle title="БЛАГОСЛОВЕНИЯ" />
        <IOSGroup>
          {availableBlessingDisplayModes.map((mode, index) => (
            <ListRow
              key={mode}
              title={blessingDisplayModeLabels[mode]}
              rightText={selectedBlessingDisplayMode === mode ? '✓' : undefined}
              onPress={() => setBlessingDefaultDisplayMode(mode)}
              isLast={index === availableBlessingDisplayModes.length - 1}
            />
          ))}
        </IOSGroup>

        <IOSGroup>
          <ListRow
            icon="🌐"
            title="Язык сидура"
            rightText={siddurLang}
            onPress={() => setSiddurLang(siddurLang === 'Русский' ? 'Иврит + русский' : 'Русский')}
            isLast
          />
        </IOSGroup>

        <SectionTitle title="НАПОМИНАНИЯ" />
        <IOSGroup>
          <ToggleRow icon="⏰" label="Напомнить о молитве" subtitle="За 15 минут до начала" value={prayerReminder} onValueChange={setPrayerReminder} />
          <ToggleRow icon="🕯️" label="Зажигание свечей" subtitle="Шаббат и праздники" value={candleReminder} onValueChange={setCandleReminder} />
          <ToggleRow icon="✡️" label="Начало Шаббата" value={shabbatReminder} onValueChange={setShabbatReminder} />
          <ToggleRow icon="🎉" label="Праздники" value={holidayReminder} onValueChange={setHolidayReminder} isLast />
        </IOSGroup>

        <Text style={{ color: colors.textDim, fontSize: 12, lineHeight: 18 }}>
          Зманим рассчитываются по выбранному городу, а не по GPS.
        </Text>
      </Screen>
    </>
  );
}
