import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { Avatar } from '@/components/ui/Avatar';
import { Logo, OmerPill } from '@/components/ui/BrandHeader';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { SegmentControl } from '@/components/ui/SegmentControl';
import { mockContacts } from '@/data/mockContacts';
import { useNow } from '@/hooks/useNow';
import { getUpcomingContactBirthdays } from '@/lib/birthdays';
import { useContactsStore } from '@/store/useContactsStore';
import { colors } from '@/theme/colors';
import type {
  BirthdayOccurrence,
  ContactItem,
  LocalContactsPermissionStatus,
  LocalIphoneContact,
} from '@/types/contact';

const tabs = ['Община', 'Мои контакты'] as const;

type BirthdayPreviewItem = {
  active: boolean;
  bg: string;
  date: string;
  id: string;
  initials: string;
  name: string;
  when: string;
};

const localAvatarPalette = ['#4A90D9', '#4A9D72', '#D9824A', '#8F6ED5', '#D94A73'];

function getLocalAvatarBg(id: string) {
  const sum = Array.from(id).reduce((value, char) => value + char.charCodeAt(0), 0);
  return localAvatarPalette[sum % localAvatarPalette.length];
}

function isLocalAccessIssue(status: LocalContactsPermissionStatus) {
  return status === 'denied' || status === 'limited' || status === 'unavailable' || status === 'error';
}

function toLocalBirthdayPreview(birthday: BirthdayOccurrence): BirthdayPreviewItem {
  return {
    active: birthday.daysUntil === 0,
    bg: birthday.avatarBg ?? getLocalAvatarBg(birthday.contactId),
    date: birthday.nextDateHebrew.label,
    id: birthday.contactId,
    initials: birthday.initials,
    name: birthday.displayName,
    when: birthday.when,
  };
}

function BirthdayRow({
  detailEnabled = true,
  isLast,
  item,
}: {
  detailEnabled?: boolean;
  isLast?: boolean;
  item: BirthdayPreviewItem;
}) {
  const router = useRouter();
  const content = (
    <>
      <Avatar initials={item.initials} bg={item.bg} size={44} />
      <View style={styles.flex}>
        <Text style={styles.rowTitle}>{item.name}</Text>
        <Text style={styles.rowSubtitle}>{item.date}</Text>
      </View>
      <Text style={[styles.whenText, item.active && styles.whenTextActive]}>{item.when}</Text>
    </>
  );

  if (!detailEnabled) {
    return <View style={[styles.birthdayRow, !isLast && styles.rowDivider]}>{content}</View>;
  }

  return (
    <Pressable
      onPress={() => router.push(`/contacts/${item.id}`)}
      style={({ pressed }) => [styles.birthdayRow, !isLast && styles.rowDivider, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

function ActionButton({ icon }: { icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.actionButton}>
      <Ionicons name={icon} size={17} color="rgba(255,255,255,0.62)" />
    </View>
  );
}

function CommunityRow({ contact, isLast }: { contact: ContactItem; isLast?: boolean }) {
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push(`/contacts/${contact.id}`)}
      style={({ pressed }) => [styles.contactRow, !isLast && styles.rowDivider, pressed && styles.pressed]}
    >
      <Avatar initials={contact.initials} bg={contact.avatarBg} size={44} />
      <View style={styles.contactContent}>
        <View style={styles.flex}>
          <Text numberOfLines={1} style={styles.rowTitle}>
            {contact.name}
          </Text>
          <View style={styles.metaLine}>
            {contact.role ? (
              <View style={[styles.rolePill, { backgroundColor: `${contact.roleColor ?? colors.orange}22` }]}>
                <Text style={[styles.roleText, { color: contact.roleColor ?? colors.orange }]}>{contact.role}</Text>
              </View>
            ) : null}
            <Text numberOfLines={1} style={styles.rowSubtitle}>
              {contact.subtitle}
            </Text>
          </View>
        </View>
        <View style={styles.actions}>
          <ActionButton icon="chatbubble-outline" />
          <ActionButton icon="call-outline" />
          <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.22)" />
        </View>
      </View>
    </Pressable>
  );
}

function LocalIphoneRow({ contact, isLast }: { contact: LocalIphoneContact; isLast?: boolean }) {
  const birthday = contact.nextHebrewBirthday;
  const nextBirthdayLabel = `${birthday.nextDateHebrew.label} · ${birthday.when}`;

  return (
    <View style={[styles.contactRow, !isLast && styles.rowDivider]}>
      <Avatar initials={contact.initials} bg={getLocalAvatarBg(contact.id)} size={44} />
      <View style={styles.contactContent}>
        <View style={styles.flex}>
          <Text numberOfLines={1} style={styles.rowTitle}>
            {contact.displayName}
          </Text>
          <Text numberOfLines={1} style={styles.rowSubtitle}>
            {contact.hebrewBirthDate.label}
          </Text>
          <View style={styles.localMetaLine}>
            <Ionicons name="calendar-outline" size={12} color={colors.orange} />
            <Text numberOfLines={1} style={styles.localMetaText}>
              {nextBirthdayLabel}
            </Text>
            <View style={styles.sourcePill}>
              <Text style={styles.sourcePillText}>iPhone</Text>
            </View>
          </View>
        </View>
        <ActionButton icon="gift-outline" />
      </View>
    </View>
  );
}

function LocalContactsStateCard({
  buttonTitle,
  icon,
  onPress,
  subtitle,
  title,
}: {
  buttonTitle?: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <GlassCard padded={false}>
      <View style={styles.stateCard}>
        <View style={styles.stateIcon}>
          <Ionicons name={icon} size={22} color="#4A90D9" />
        </View>
        <View style={styles.flex}>
          <Text style={styles.stateTitle}>{title}</Text>
          <Text style={styles.stateSubtitle}>{subtitle}</Text>
        </View>
        {buttonTitle && onPress ? (
          <Pressable onPress={onPress} style={({ pressed }) => [styles.stateButton, pressed && styles.pressed]}>
            <Text style={styles.stateButtonText}>{buttonTitle}</Text>
          </Pressable>
        ) : null}
      </View>
    </GlassCard>
  );
}

export default function ContactsScreen() {
  const now = useNow();
  const [tab, setTab] = useState<(typeof tabs)[number]>('Община');
  const [search, setSearch] = useState('');
  const localContacts = useContactsStore((state) => state.localContacts);
  const localContactsPermission = useContactsStore((state) => state.localContactsPermission);
  const loadingLocal = useContactsStore((state) => state.loadingLocal);
  const loadLocalContacts = useContactsStore((state) => state.loadLocalContacts);
  const upcomingBirthdays = useContactsStore((state) => state.upcomingBirthdays);

  const normalizedSearch = search.trim().toLowerCase();
  const community = useMemo(
    () => mockContacts.filter((contact) => contact.name.toLowerCase().includes(normalizedSearch)),
    [normalizedSearch],
  );
  const personal = useMemo(
    () => localContacts.filter((contact) => contact.displayName.toLowerCase().includes(normalizedSearch)),
    [localContacts, normalizedSearch],
  );
  const birthdays = useMemo<BirthdayPreviewItem[]>(
    () =>
      getUpcomingContactBirthdays(mockContacts, now, 3).map(({ birthday, contact }) => ({
        active: birthday.daysUntil === 0,
        bg: contact.avatarBg ?? '#2a3a4a',
        date: birthday.nextBirthday,
        id: contact.id,
        initials: contact.initials,
        name: contact.name,
        when: birthday.when,
      })),
    [now],
  );
  const localBirthdays = useMemo(
    () => upcomingBirthdays.filter((birthday) => birthday.source === 'iphone').slice(0, 3).map(toLocalBirthdayPreview),
    [upcomingBirthdays],
  );

  const isCommunity = tab === 'Община';
  const canShowLocalContacts = localContactsPermission === 'granted';
  const localContactsCount = localContacts.length;
  const showLocalCount = canShowLocalContacts && !loadingLocal;

  function renderLocalContactsContent() {
    if (loadingLocal) {
      return (
        <LocalContactsStateCard
          icon="sync"
          title="Загружаем контакты…"
          subtitle="Ищем локальные контакты iPhone с днями рождения"
        />
      );
    }

    if (localContactsPermission === 'unknown') {
      return (
        <LocalContactsStateCard
          buttonTitle="Разрешить доступ"
          icon="phone-portrait-outline"
          onPress={loadLocalContacts}
          title="Синхронизация iPhone"
          subtitle="Покажем контакты с днями рождения и рассчитаем еврейские даты"
        />
      );
    }

    if (isLocalAccessIssue(localContactsPermission)) {
      return (
        <LocalContactsStateCard
          buttonTitle="Повторить"
          icon="alert-circle-outline"
          onPress={loadLocalContacts}
          title="Доступ к контактам не разрешён"
          subtitle="Разрешите доступ в настройках iPhone, чтобы видеть дни рождения"
        />
      );
    }

    if (personal.length === 0) {
      if (!search) {
        return (
          <LocalContactsStateCard
            icon="calendar-outline"
            title="Контактов с днями рождения не найдено"
            subtitle="Добавьте дату рождения в карточку контакта iPhone"
          />
        );
      }

      return (
        <GlassCard padded={false}>
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Контакты не найдены</Text>
          </View>
        </GlassCard>
      );
    }

    return (
      <GlassCard padded={false}>
        {personal.map((contact, index) => (
          <LocalIphoneRow key={contact.id} contact={contact} isLast={index === personal.length - 1} />
        ))}
      </GlassCard>
    );
  }

  return (
    <Screen contentContainerStyle={styles.screenContent}>
      <View style={styles.header}>
        <Logo />
        <OmerPill />
      </View>

      <View>
        <Text style={styles.title}>Контакты</Text>
        <Text style={styles.subtitle}>Община и личные даты</Text>
      </View>

      <SegmentControl items={tabs} value={tab} onChange={setTab} />

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color="rgba(255,255,255,0.35)" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Поиск контактов"
            placeholderTextColor="rgba(255,255,255,0.35)"
            selectionColor={colors.orange}
            style={styles.searchInput}
          />
          {search ? (
            <Pressable onPress={() => setSearch('')}>
              <Ionicons name="close" size={16} color="rgba(255,255,255,0.35)" />
            </Pressable>
          ) : null}
        </View>
        <Pressable style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
          <Ionicons name="person-add-outline" size={20} color="#fff" />
        </Pressable>
      </View>

      {isCommunity && !search ? (
        <View>
          <SectionTitle title="БЛИЖАЙШИЕ ДНИ РОЖДЕНИЯ" action="Все дни рождения →" />
          <GlassCard padded={false}>
            {birthdays.map((item, index) => (
              <BirthdayRow key={item.id} item={item} isLast={index === birthdays.length - 1} />
            ))}
          </GlassCard>
        </View>
      ) : null}

      {!isCommunity && !search && localBirthdays.length > 0 ? (
        <View>
          <SectionTitle title="БЛИЖАЙШИЕ ДНИ РОЖДЕНИЯ ИЗ iPhone" />
          <GlassCard padded={false}>
            {localBirthdays.map((item, index) => (
              <BirthdayRow
                key={item.id}
                detailEnabled={false}
                item={item}
                isLast={index === localBirthdays.length - 1}
              />
            ))}
          </GlassCard>
        </View>
      ) : null}

      {!isCommunity && !search && showLocalCount ? (
        <View style={styles.personalHint}>
          <View style={styles.hintIcon}>
            <Ionicons name="phone-portrait-outline" size={20} color="#4A90D9" />
          </View>
          <View style={styles.flex}>
            <Text style={styles.rowTitle}>{localContactsCount} контактов с днями рождения</Text>
            <Text style={styles.rowSubtitle}>Еврейские даты рассчитаны автоматически</Text>
          </View>
        </View>
      ) : null}

      <View>
        <SectionTitle
          title={isCommunity ? 'КОНТАКТЫ ОБЩИНЫ' : 'МОИ КОНТАКТЫ'}
          action={isCommunity && !search ? 'Все контакты →' : undefined}
        />
        {isCommunity ? (
          <GlassCard padded={false}>
            {community.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>Контакты не найдены</Text>
              </View>
            ) : (
              community.map((contact, index) => (
                <CommunityRow key={contact.id} contact={contact} isLast={index === community.length - 1} />
              ))
            )}
          </GlassCard>
        ) : (
          renderLocalContactsContent()
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 13,
    marginTop: 2,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchBox: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w07,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    paddingVertical: 0,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.orange,
    shadowColor: colors.orange,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  birthdayRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  contactRow: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  contactContent: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  rowTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  rowSubtitle: {
    color: colors.textGhost,
    fontSize: 12,
    marginTop: 2,
  },
  localMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 7,
  },
  localMetaText: {
    flex: 1,
    minWidth: 0,
    color: colors.textFaint,
    fontSize: 12,
    fontWeight: '600',
  },
  sourcePill: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(74,144,217,0.24)',
    backgroundColor: 'rgba(74,144,217,0.12)',
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  sourcePillText: {
    color: '#8DBBE8',
    fontSize: 10,
    fontWeight: '700',
    includeFontPadding: false,
  },
  whenText: {
    color: colors.textFaint,
    fontSize: 13,
    fontWeight: '600',
  },
  whenTextActive: {
    color: colors.orange,
  },
  stateCard: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  stateIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(74,144,217,0.20)',
    backgroundColor: 'rgba(74,144,217,0.12)',
  },
  stateTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  stateSubtitle: {
    color: colors.textGhost,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  stateButton: {
    minHeight: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.orange,
    paddingHorizontal: 12,
  },
  stateButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  personalHint: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(74,144,217,0.20)',
    backgroundColor: 'rgba(74,144,217,0.08)',
    paddingHorizontal: 16,
  },
  hintIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(74,144,217,0.20)',
    backgroundColor: 'rgba(74,144,217,0.12)',
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
    flexWrap: 'wrap',
  },
  rolePill: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  roleText: {
    fontSize: 11,
    fontWeight: '700',
    includeFontPadding: false,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w07,
  },
  empty: {
    minHeight: 80,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  emptyText: {
    color: colors.textGhost,
    fontSize: 14,
  },
  pressed: {
    opacity: 0.78,
  },
});
