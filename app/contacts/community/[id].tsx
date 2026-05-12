import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { Avatar } from '@/components/ui/Avatar';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { mockContacts } from '@/data/mockContacts';
import { useNow } from '@/hooks/useNow';
import { getContactBirthdayInfo } from '@/lib/birthdays';
import { decodeContactRouteId } from '@/lib/contactRoutes';
import { colors } from '@/theme/colors';

const contactsRoute = '/contacts';

function InfoRow({
  accent,
  icon,
  label,
  subtitle,
  value,
}: {
  accent?: boolean;
  icon: string;
  label: string;
  subtitle?: string;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Text style={styles.infoEmoji}>{icon}</Text>
      </View>
      <View style={styles.flex}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={[styles.infoValue, accent && styles.infoValueAccent]}>{value}</Text>
        {subtitle ? <Text style={styles.infoSubtitle}>{subtitle}</Text> : null}
      </View>
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

export default function CommunityContactDetail() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const router = useRouter();
  const now = useNow();
  const contactId = decodeContactRouteId(id);
  const contact = mockContacts.find((item) => item.id === contactId);
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace(contactsRoute);
  };

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
  pressed: {
    opacity: 0.78,
  },
});
