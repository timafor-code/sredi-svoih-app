import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Fragment, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { Avatar } from '@/components/ui/Avatar';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { mockContacts } from '@/data/mockContacts';
import { useNow } from '@/hooks/useNow';
import { getContactBirthdayInfo } from '@/lib/birthdays';
import { decodeContactRouteId } from '@/lib/contactRoutes';
import { formatRuDate } from '@/lib/dates';
import { contactsService } from '@/services/contactsService';
import { useContactsStore } from '@/store/useContactsStore';
import { colors } from '@/theme/colors';
import type { CommunityContact } from '@/types/contact';

const contactsRoute = '/contacts';

type InfoRowData = {
  accent?: boolean;
  href?: string;
  icon: string;
  key: string;
  label: string;
  subtitle?: string;
  value: string;
};

function toDialable(phone: string) {
  const trimmed = phone.trim();
  return (trimmed.startsWith('+') ? '+' : '') + trimmed.replace(/\D/g, '');
}

function InfoRow({
  accent,
  icon,
  label,
  onPress,
  subtitle,
  value,
}: {
  accent?: boolean;
  icon: string;
  label: string;
  onPress?: () => void;
  subtitle?: string;
  value: string;
}) {
  const content = (
    <>
      <View style={styles.infoIcon}>
        <Text style={styles.infoEmoji}>{icon}</Text>
      </View>
      <View style={styles.flex}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={[styles.infoValue, accent && styles.infoValueAccent]}>{value}</Text>
        {subtitle ? <Text style={styles.infoSubtitle}>{subtitle}</Text> : null}
      </View>
    </>
  );

  if (!onPress) {
    return <View style={styles.infoRow}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityLabel={`${label}: ${value}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.infoRow, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

function InfoRowsCard({ onOpen, rows }: { onOpen?: (url: string) => void; rows: InfoRowData[] }) {
  return (
    <GlassCard padded={false}>
      {rows.map((row, index) => (
        <Fragment key={row.key}>
          {index > 0 ? <View style={styles.separator} /> : null}
          <InfoRow
            accent={row.accent}
            icon={row.icon}
            label={row.label}
            onPress={row.href && onOpen ? () => onOpen(row.href as string) : undefined}
            subtitle={row.subtitle}
            value={row.value}
          />
        </Fragment>
      ))}
    </GlassCard>
  );
}

function parseDateOnly(value?: string): Date | null {
  if (!value) return null;

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);

  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return date;
}

function formatDateOnly(value: string) {
  const date = parseDateOnly(value);
  return date ? formatRuDate(date) : value;
}

function getBackendBirthday(contact: CommunityContact, now: Date) {
  return contactsService.getUpcomingBirthdays({ communityContacts: [contact], fromDate: now, limit: 1 })[0];
}

function getBackendContactRows(contact: CommunityContact): InfoRowData[] {
  const phone = contact.phone ?? contact.phoneNumbers[0]?.number;
  const rows: (InfoRowData | null)[] = [
    phone
      ? {
          href: `tel:${toDialable(phone)}`,
          icon: '☎️',
          key: 'phone',
          label: 'Телефон',
          value: phone,
        }
      : null,
    contact.email
      ? {
          href: `mailto:${contact.email}`,
          icon: '✉️',
          key: 'email',
          label: 'Email',
          value: contact.email,
        }
      : null,
  ];
  return rows.filter((row): row is InfoRowData => Boolean(row));
}

function getBackendProfileRows(contact: CommunityContact): InfoRowData[] {
  const birthdayRow = contact.birthDate
    ? {
        icon: '🎂',
        key: 'birthDate',
        label: 'Дата рождения',
        subtitle: contact.hebrewBirthDate?.label,
        value: formatDateOnly(contact.birthDate),
      }
    : contact.hebrewBirthDate
      ? {
          icon: '🎂',
          key: 'hebrewBirthDate',
          label: 'Еврейская дата рождения',
          value: contact.hebrewBirthDate.label,
        }
      : null;

  return [
    birthdayRow,
    contact.hebrewName
      ? {
          icon: '✡️',
          key: 'hebrewName',
          label: 'Еврейское имя',
          value: contact.hebrewName,
        }
      : null,
  ].filter((row): row is InfoRowData => Boolean(row));
}

function ContactActions({ contact, onOpen }: { contact: CommunityContact; onOpen: (url: string) => void }) {
  const phone = contact.phone ?? contact.phoneNumbers[0]?.number;
  const actions = [
    phone ? { icon: 'call-outline', label: 'Позвонить', url: `tel:${toDialable(phone)}` } : null,
    phone ? { icon: 'chatbubble-outline', label: 'Написать', url: `sms:${toDialable(phone)}` } : null,
    contact.email ? { icon: 'mail-outline', label: 'Email', url: `mailto:${contact.email}` } : null,
  ].filter((action): action is { icon: string; label: string; url: string } => Boolean(action));

  if (actions.length === 0) return null;

  return (
    <View style={styles.actionRow}>
      {actions.map((action) => (
        <Pressable
          key={action.label}
          accessibilityLabel={action.label}
          accessibilityRole="button"
          onPress={() => onOpen(action.url)}
          style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
        >
          <Ionicons name={action.icon as keyof typeof Ionicons.glyphMap} size={18} color={colors.orange} />
          <Text style={styles.actionText}>{action.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function NotFoundState() {
  const router = useRouter();
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace(contactsRoute);
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen>
        <Pressable onPress={handleBack} style={styles.backRow}>
          <Ionicons name="chevron-back" size={22} color={colors.orange} />
          <Text style={styles.backText}>Назад</Text>
        </Pressable>

        <GlassCard>
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="person-circle-outline" size={26} color={colors.textGhost} />
            </View>
            <Text style={styles.emptyTitle}>Контакт не найден</Text>
            <Text style={styles.emptySubtitle}>Откройте вкладку «Община» и выберите контакт из списка</Text>
            <Pressable onPress={handleBack} style={({ pressed }) => [styles.stateButton, pressed && styles.pressed]}>
              <Text style={styles.stateButtonText}>Назад</Text>
            </Pressable>
          </View>
        </GlassCard>
      </Screen>
    </>
  );
}

function BackendCommunityContactDetail({
  contact,
  now,
  onBack,
}: {
  contact: CommunityContact;
  now: Date;
  onBack: () => void;
}) {
  const [linkError, setLinkError] = useState<string | null>(null);
  const contactRows = getBackendContactRows(contact);
  const profileRows = getBackendProfileRows(contact);
  const birthday = getBackendBirthday(contact, now);
  const heroSubtitle = [
    contact.city,
    contact.subtitle && contact.subtitle !== contact.role ? contact.subtitle : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  const handleOpen = async (url: string) => {
    setLinkError(null);
    try {
      await Linking.openURL(url);
    } catch {
      setLinkError('Не удалось открыть приложение для этого действия');
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen>
        <Pressable onPress={onBack} style={styles.backRow}>
          <Ionicons name="chevron-back" size={22} color={colors.orange} />
          <Text style={styles.backText}>Контакты</Text>
        </Pressable>

        <GlassCard>
          <View style={styles.hero}>
            <Avatar initials={contact.initials} bg={contact.avatarBg} uri={contact.avatarUrl} size={82} />
            <View style={styles.flex}>
              <Text style={styles.name}>{contact.displayName}</Text>
              {heroSubtitle ? <Text style={styles.city}>{heroSubtitle}</Text> : null}
              {contact.role ? (
                <View style={[styles.rolePill, { borderColor: `${contact.roleColor ?? colors.orange}55`, backgroundColor: `${contact.roleColor ?? colors.orange}22` }]}>
                  <Text style={[styles.roleText, { color: contact.roleColor ?? colors.orange }]}>{contact.role}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </GlassCard>

        <ContactActions contact={contact} onOpen={handleOpen} />

        {contactRows.length > 0 ? (
          <View>
            <SectionTitle title="КОНТАКТЫ" />
            <InfoRowsCard onOpen={handleOpen} rows={contactRows} />
            {linkError ? <Text style={styles.linkError}>{linkError}</Text> : null}
          </View>
        ) : null}

        {profileRows.length > 0 ? (
          <View>
            <SectionTitle title="ПРОФИЛЬ" />
            <InfoRowsCard rows={profileRows} />
          </View>
        ) : null}

        {birthday ? (
          <View>
            <SectionTitle title="ЕВРЕЙСКИЙ КАЛЕНДАРЬ" />
            <GlassCard style={styles.birthdayCard}>
              <View style={styles.birthdayContent}>
                <Text style={styles.birthdayEmoji}>🎂</Text>
                <View style={styles.flex}>
                  <Text style={styles.goldOverline}>СЛЕДУЮЩИЙ ДЕНЬ РОЖДЕНИЯ</Text>
                  <Text style={styles.goldTitle}>{birthday.nextDateHebrew.label}</Text>
                  <Text style={styles.infoSubtitle}>
                    {formatDateOnly(birthday.nextDateGregorian)} · {birthday.when}
                  </Text>
                </View>
              </View>
            </GlassCard>
          </View>
        ) : null}
      </Screen>
    </>
  );
}

export default function CommunityContactDetail() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const router = useRouter();
  const now = useNow();
  const contactId = decodeContactRouteId(id);
  const backendContact = useContactsStore((state) =>
    state.communityContacts.find((item) => item.id === contactId),
  );
  const contact = mockContacts.find((item) => item.id === contactId);
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace(contactsRoute);
  };

  if (backendContact) {
    return <BackendCommunityContactDetail contact={backendContact} now={now} onBack={handleBack} />;
  }

  if (!contact) {
    return <NotFoundState />;
  }

  const birthdayInfo = getContactBirthdayInfo(contact, now);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen>
        <Pressable onPress={handleBack} style={styles.backRow}>
          <Ionicons name="chevron-back" size={22} color={colors.orange} />
          <Text style={styles.backText}>Контакты</Text>
        </Pressable>

        <GlassCard>
          <View style={styles.hero}>
            <Avatar initials={contact.initials} bg={contact.avatarBg} size={82} />
            <View style={styles.flex}>
              <Text style={styles.name}>{contact.name}</Text>
              <Text style={styles.hebrew}>{contact.hebrewName}</Text>
              <Text style={styles.city}>{contact.city} · {contact.subtitle ?? contact.role ?? 'Участник общины'}</Text>
              {contact.role ? (
                <View style={[styles.rolePill, { borderColor: `${contact.roleColor ?? colors.orange}55`, backgroundColor: `${contact.roleColor ?? colors.orange}22` }]}>
                  <Text style={[styles.roleText, { color: contact.roleColor ?? colors.orange }]}>{contact.role}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </GlassCard>

        <View>
          <SectionTitle title="КОНТАКТЫ" />
          <GlassCard padded={false}>
            <InfoRow icon="☎️" label="Телефон" value={contact.phone} />
            <View style={styles.separator} />
            <InfoRow icon="✉️" label="Email" value={contact.email} />
          </GlassCard>
        </View>

        <View>
          <SectionTitle title="ПРОФИЛЬ" />
          <GlassCard padded={false}>
            <InfoRow icon="🎂" label="Дата рождения" value={contact.dobGregorian} subtitle={birthdayInfo?.dobHebrew ?? contact.dobHebrew} />
            <View style={styles.separator} />
            <InfoRow icon="✡️" label="Происхождение" value={contact.tribe} />
            <View style={styles.separator} />
            <InfoRow icon="👤" label="Семейное положение" value={contact.marital ?? 'Не указано'} />
          </GlassCard>
        </View>

        {contact.bio ? (
          <View>
            <SectionTitle title="О ЧЕЛОВЕКЕ" />
            <GlassCard>
              <Text style={styles.bio}>{contact.bio}</Text>
            </GlassCard>
          </View>
        ) : null}

        {contact.activities?.length ? (
          <View>
            <SectionTitle title="АКТИВНОСТЬ В ОБЩИНЕ" />
            <GlassCard padded={false}>
              {contact.activities.map((activity, index) => (
                <View key={activity.title} style={[styles.activityRow, index > 0 && styles.separatorTop]}>
                  <View style={styles.infoIcon}>
                    <Text style={styles.infoEmoji}>{activity.icon}</Text>
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.activityTitle}>{activity.title}</Text>
                    <Text style={styles.infoSubtitle}>{activity.subtitle}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.25)" />
                </View>
              ))}
            </GlassCard>
          </View>
        ) : null}

        <View>
          <SectionTitle title="ЕВРЕЙСКИЙ КАЛЕНДАРЬ" />
          <GlassCard style={styles.birthdayCard}>
            <View style={styles.birthdayContent}>
              <Text style={styles.birthdayEmoji}>🎂</Text>
              <View style={styles.flex}>
                <Text style={styles.goldOverline}>СЛЕДУЮЩИЙ ДЕНЬ РОЖДЕНИЯ</Text>
                <Text style={styles.goldTitle}>{birthdayInfo?.nextBirthday ?? contact.nextBirthday}</Text>
                <Text style={styles.infoSubtitle}>{birthdayInfo?.nextBirthdaySub ?? contact.nextBirthdaySub}</Text>
              </View>
            </View>
          </GlassCard>
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  backRow: {
    alignSelf: 'flex-start',
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backText: {
    color: colors.orange,
    fontSize: 15,
    fontWeight: '600',
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0,
  },
  hebrew: {
    color: colors.textGhost,
    fontSize: 14,
    fontStyle: 'italic',
    marginTop: 2,
  },
  city: {
    color: colors.textDim,
    fontSize: 12,
    marginTop: 5,
  },
  rolePill: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 10,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '700',
  },
  infoRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.glass.w08,
    backgroundColor: colors.glass.w07,
  },
  infoEmoji: {
    fontSize: 16,
  },
  infoLabel: {
    color: colors.textGhost,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  infoValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 3,
  },
  infoValueAccent: {
    color: colors.orange,
  },
  infoSubtitle: {
    color: colors.textGhost,
    fontSize: 12,
    marginTop: 2,
    lineHeight: 17,
  },
  separator: {
    height: 1,
    marginHorizontal: 16,
    backgroundColor: colors.separator,
  },
  separatorTop: {
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  bio: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  activityRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  activityTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  birthdayCard: {
    borderColor: 'rgba(255,200,50,0.14)',
    backgroundColor: 'rgba(255,200,50,0.05)',
  },
  birthdayContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  birthdayEmoji: {
    fontSize: 32,
  },
  goldOverline: {
    color: colors.accent.goldTextDim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  goldTitle: {
    color: colors.accent.goldText,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 4,
  },
  emptyState: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w07,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptySubtitle: {
    color: colors.textGhost,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  stateButton: {
    minHeight: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.orange,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  stateButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w07,
  },
  actionText: {
    color: colors.orange,
    fontSize: 13,
    fontWeight: '700',
  },
  linkError: {
    color: colors.textGhost,
    fontSize: 12,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  pressed: {
    opacity: 0.78,
  },
});
