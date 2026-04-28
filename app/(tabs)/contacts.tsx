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
import { mockContacts, mockPersonalContacts } from '@/data/mockContacts';
import { useNow } from '@/hooks/useNow';
import { getUpcomingContactBirthdays } from '@/lib/birthdays';
import { colors } from '@/theme/colors';
import type { ContactItem } from '@/types/contact';

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

type PersonalContact = (typeof mockPersonalContacts)[number];

function BirthdayRow({ item, isLast }: { item: BirthdayPreviewItem; isLast?: boolean }) {
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push(`/contacts/${item.id}`)}
      style={({ pressed }) => [styles.birthdayRow, !isLast && styles.rowDivider, pressed && styles.pressed]}
    >
      <Avatar initials={item.initials} bg={item.bg} size={44} />
      <View style={styles.flex}>
        <Text style={styles.rowTitle}>{item.name}</Text>
        <Text style={styles.rowSubtitle}>{item.date}</Text>
      </View>
      <Text style={[styles.whenText, item.active && styles.whenTextActive]}>{item.when}</Text>
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

function PersonalRow({ contact, isLast }: { contact: PersonalContact; isLast?: boolean }) {
  return (
    <View style={[styles.contactRow, !isLast && styles.rowDivider]}>
      <Avatar initials={contact.initials} bg={contact.avatarBg} size={44} />
      <View style={styles.contactContent}>
        <View style={styles.flex}>
          <Text numberOfLines={1} style={styles.rowTitle}>
            {contact.name}
          </Text>
          <Text numberOfLines={1} style={styles.rowSubtitle}>
            {contact.subtitle}
          </Text>
        </View>
        <ActionButton icon="gift-outline" />
      </View>
    </View>
  );
}

export default function ContactsScreen() {
  const now = useNow();
  const [tab, setTab] = useState<(typeof tabs)[number]>('Община');
  const [search, setSearch] = useState('');

  const normalizedSearch = search.trim().toLowerCase();
  const community = useMemo(
    () => mockContacts.filter((contact) => contact.name.toLowerCase().includes(normalizedSearch)),
    [normalizedSearch],
  );
  const personal = useMemo(
    () => mockPersonalContacts.filter((contact) => contact.name.toLowerCase().includes(normalizedSearch)),
    [normalizedSearch],
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

  const isCommunity = tab === 'Община';
  const contacts = isCommunity ? community : personal;

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
              <BirthdayRow key={item.name} item={item} isLast={index === birthdays.length - 1} />
            ))}
          </GlassCard>
        </View>
      ) : null}

      {isCommunity && !search ? (
        <GlassCard padded={false}>
          <View style={styles.syncBanner}>
            <View style={styles.syncIcon}>
              <Ionicons name="sync" size={20} color="#4A90D9" />
            </View>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>Синхронизация iPhone</Text>
              <Text style={styles.rowSubtitle}>128 личных контактов с еврейскими датами</Text>
            </View>
            <View style={styles.syncStatus}>
              <Text style={styles.syncStatusText}>Включена</Text>
              <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.3)" />
            </View>
          </View>
        </GlassCard>
      ) : null}

      {!isCommunity && !search ? (
        <View style={styles.personalHint}>
          <Text style={styles.hintEmoji}>📱</Text>
          <View style={styles.flex}>
            <Text style={styles.rowTitle}>128 контактов синхронизировано</Text>
            <Text style={styles.rowSubtitle}>Еврейские даты рассчитаны автоматически</Text>
          </View>
        </View>
      ) : null}

      <View>
        <SectionTitle title={isCommunity ? 'КОНТАКТЫ ОБЩИНЫ' : 'МОИ КОНТАКТЫ'} action={!search ? 'Все контакты →' : undefined} />
        <GlassCard padded={false}>
          {contacts.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Контакты не найдены</Text>
            </View>
          ) : isCommunity ? (
            community.map((contact, index) => (
              <CommunityRow key={contact.id} contact={contact} isLast={index === community.length - 1} />
            ))
          ) : (
            personal.map((contact, index) => (
              <PersonalRow key={contact.id} contact={contact} isLast={index === personal.length - 1} />
            ))
          )}
        </GlassCard>
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
  whenText: {
    color: colors.textFaint,
    fontSize: 13,
    fontWeight: '600',
  },
  whenTextActive: {
    color: colors.orange,
  },
  syncBanner: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  syncIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(74,144,217,0.20)',
    backgroundColor: 'rgba(74,144,217,0.12)',
  },
  syncStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  syncStatusText: {
    color: colors.success,
    fontSize: 13,
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
  hintEmoji: {
    fontSize: 22,
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
