import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { IOSGroup } from '@/components/ui/IOSGroup';
import { ListRow } from '@/components/ui/ListRow';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { SubHeader } from '@/components/ui/SubHeader';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { useContactVisibilityStore } from '@/store/useContactVisibilityStore';
import { colors } from '@/theme/colors';
import type { ContactVisibilityUpdateInput } from '@/types/contact';

const AUTH_REQUIRED_MESSAGE =
  'Чтобы управлять публикацией в каталоге общины, войдите в приложение.';

function getVisibilityErrorMessage(error: string | null): string | null {
  if (!error) {
    return null;
  }

  if (error === 'auth_required') {
    return AUTH_REQUIRED_MESSAGE;
  }

  if (error === 'contact_visibility_not_loaded') {
    return 'Настройки каталога ещё не загружены. Попробуйте повторить.';
  }

  return 'Не удалось загрузить или сохранить настройки каталога. Попробуйте ещё раз.';
}

type CommunityErrorCardProps = {
  message: string;
  onRetry?: () => void;
};

function CommunityErrorCard({ message, onRetry }: CommunityErrorCardProps) {
  return (
    <GlassCard>
      <View style={styles.messageCard}>
        <Text style={styles.errorTitle}>Настройки каталога недоступны</Text>
        <Text style={styles.messageText}>{message}</Text>
        {onRetry ? (
          <PrimaryButton title="Повторить" onPress={onRetry} />
        ) : null}
      </View>
    </GlassCard>
  );
}

export default function ContactsSettingsScreen() {
  const [syncContacts, setSyncContacts] = useState(true);
  const [birthdaysReminder, setBirthdaysReminder] = useState(true);
  const [advance, setAdvance] = useState('За 3 дня');

  const visibility = useContactVisibilityStore((state) => state.visibility);
  const loading = useContactVisibilityStore((state) => state.loading);
  const saving = useContactVisibilityStore((state) => state.saving);
  const error = useContactVisibilityStore((state) => state.error);
  const loaded = useContactVisibilityStore((state) => state.loaded);
  const loadVisibility = useContactVisibilityStore((state) => state.loadVisibility);
  const updateVisibility = useContactVisibilityStore((state) => state.updateVisibility);

  useEffect(() => {
    void loadVisibility();
  }, [loadVisibility]);

  const handleVisibilityChange = useCallback(
    (patch: Partial<ContactVisibilityUpdateInput>) => {
      void updateVisibility(patch);
    },
    [updateVisibility],
  );

  const toggleAdvance = useCallback(() => {
    setAdvance((current) => (current === 'За 3 дня' ? 'За 1 день' : 'За 3 дня'));
  }, []);

  const errorMessage = getVisibilityErrorMessage(error);
  const isAuthRequired = error === 'auth_required';
  const isInitialLoading = loading && !visibility && !loaded;
  const fieldTogglesDisabled = saving || !visibility?.showInCommunityDirectory;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen contentContainerStyle={{ gap: 16 }}>
        <SubHeader
          title="Контакты и дни рождения"
          subtitle="iPhone локально, каталог общины через настройки публикации"
        />

        <SectionTitle title="КОНТАКТЫ IPHONE" />
        <IOSGroup>
          <ToggleRow
            icon="📱"
            label="Синхронизация контактов iPhone"
            subtitle="Локально на устройстве"
            value={syncContacts}
            onValueChange={setSyncContacts}
          />
          <ToggleRow
            icon="🎂"
            label="Напоминания о днях рождения iPhone"
            subtitle="Локальные напоминания"
            value={birthdaysReminder}
            onValueChange={setBirthdaysReminder}
          />
          <ListRow
            icon="⏰"
            title="Заблаговременно"
            subtitle="Только для контактов iPhone"
            rightText={advance}
            onPress={toggleAdvance}
            isLast
          />
        </IOSGroup>

        <GlassCard>
          <Text style={styles.messageText}>
            Контакты iPhone не отправляются в Supabase и используются только локально на устройстве.
          </Text>
        </GlassCard>

        <View style={styles.sectionHeader}>
          <SectionTitle title="КАТАЛОГ ОБЩИНЫ" />
          {saving ? <Text style={styles.savingText}>Сохраняем...</Text> : null}
        </View>

        {isInitialLoading ? (
          <GlassCard>
            <Text style={styles.messageText}>Загружаем настройки...</Text>
          </GlassCard>
        ) : null}

        {!isInitialLoading && !visibility && errorMessage ? (
          <CommunityErrorCard
            message={errorMessage}
            onRetry={isAuthRequired ? undefined : () => void loadVisibility()}
          />
        ) : null}

        {visibility ? (
          <>
            <GlassCard>
              <Text style={styles.messageText}>
                Поля ниже начнут отображаться только если включён каталог общины.
              </Text>
            </GlassCard>

            <IOSGroup>
              <ToggleRow
                icon="👥"
                label="Показываться в каталоге общины"
                subtitle="Другие участники смогут найти вашу карточку"
                value={visibility.showInCommunityDirectory}
                onValueChange={(value) => handleVisibilityChange({ showInCommunityDirectory: value })}
                disabled={saving}
              />
              <ToggleRow
                icon="☎️"
                label="Показывать телефон"
                value={visibility.sharePhone}
                onValueChange={(value) => handleVisibilityChange({ sharePhone: value })}
                disabled={fieldTogglesDisabled}
              />
              <ToggleRow
                icon="✉️"
                label="Показывать email"
                value={visibility.shareEmail}
                onValueChange={(value) => handleVisibilityChange({ shareEmail: value })}
                disabled={fieldTogglesDisabled}
              />
              <ToggleRow
                icon="🎂"
                label="Показывать дату рождения"
                value={visibility.shareBirthDate}
                onValueChange={(value) => handleVisibilityChange({ shareBirthDate: value })}
                disabled={fieldTogglesDisabled}
              />
              <ToggleRow
                icon="✡️"
                label="Показывать еврейскую дату рождения"
                value={visibility.shareHebrewBirthDate}
                onValueChange={(value) => handleVisibilityChange({ shareHebrewBirthDate: value })}
                disabled={fieldTogglesDisabled}
              />
              <ToggleRow
                icon="📍"
                label="Показывать город"
                value={visibility.shareCity}
                onValueChange={(value) => handleVisibilityChange({ shareCity: value })}
                disabled={fieldTogglesDisabled}
              />
              <ToggleRow
                icon="🕊️"
                label="Показывать еврейское имя"
                value={visibility.shareHebrewName}
                onValueChange={(value) => handleVisibilityChange({ shareHebrewName: value })}
                disabled={fieldTogglesDisabled}
              />
              <ToggleRow
                icon="🔔"
                label="Напоминать участникам о моём дне рождения"
                value={visibility.birthdayRemindersEnabled}
                onValueChange={(value) => handleVisibilityChange({ birthdayRemindersEnabled: value })}
                disabled={fieldTogglesDisabled}
                isLast
              />
            </IOSGroup>

            {errorMessage ? (
              <CommunityErrorCard message={errorMessage} onRetry={() => void loadVisibility()} />
            ) : null}
          </>
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  savingText: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '600',
    marginRight: 4,
  },
  messageCard: {
    gap: 12,
  },
  errorTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  messageText: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 20,
  },
});
