import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { Avatar } from '@/components/ui/Avatar';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { decodeContactRouteId } from '@/lib/contactRoutes';
import { getLocalContactAvatarBg } from '@/lib/contactAvatar';
import { formatRuDate } from '@/lib/dates';
import { useContactsStore } from '@/store/useContactsStore';
import { colors } from '@/theme/colors';
import type { ContactPhoneNumber } from '@/types/contact';

const contactsRoute = '/contacts';

function formatDateOnly(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return value;

  return formatRuDate(date);
}

function InfoRow({
  accent,
  icon,
  label,
  subtitle,
  value,
}: {
  accent?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Ionicons name={icon} size={18} color={accent ? colors.orange : colors.textGhost} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={[styles.infoValue, accent && styles.infoValueAccent]}>{value}</Text>
        {subtitle ? <Text style={styles.infoSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

function PhoneRows({ phoneNumbers }: { phoneNumbers: ContactPhoneNumber[] }) {
  if (phoneNumbers.length === 0) {
    return <InfoRow icon="call-outline" label="Телефон" value="Не указан" />;
  }

  return (
    <>
      {phoneNumbers.map((phone, index) => (
        <View key={phone.id ?? `${phone.number}:${index}`}>
          {index > 0 ? <View style={styles.separator} /> : null}
          <InfoRow
            icon="call-outline"
            label={phone.label ? `Телефон · ${phone.label}` : 'Телефон'}
            value={phone.number}
          />
        </View>
      ))}
    </>
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
              <Ionicons name="phone-portrait-outline" size={26} color={colors.textGhost} />
            </View>
            <Text style={styles.emptyTitle}>Контакт не найден</Text>
            <Text style={styles.emptySubtitle}>Откройте вкладку «Мои контакты» и разрешите доступ к контактам</Text>
            <Pressable onPress={handleBack} style={({ pressed }) => [styles.stateButton, pressed && styles.pressed]}>
              <Text style={styles.stateButtonText}>Назад</Text>
            </Pressable>
          </View>
        </GlassCard>
      </Screen>
    </>
  );
}

export default function IphoneContactDetail() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const contactId = decodeContactRouteId(id);
  const router = useRouter();
  const contact = useContactsStore((state) => state.localContacts.find((item) => item.id === contactId));
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

  const birthday = contact.nextHebrewBirthday;

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
            <Avatar initials={contact.initials} bg={getLocalContactAvatarBg(contact.id)} size={82} />
            <View style={styles.flex}>
              <Text style={styles.name}>{contact.displayName}</Text>
              <View style={styles.sourcePill}>
                <Ionicons name="phone-portrait-outline" size={12} color="#8DBBE8" />
                <Text style={styles.sourcePillText}>iPhone</Text>
              </View>
            </View>
          </View>
        </GlassCard>

        <View>
          <SectionTitle title="КОНТАКТЫ" />
          <GlassCard padded={false}>
            <PhoneRows phoneNumbers={contact.phoneNumbers} />
          </GlassCard>
        </View>

        <View>
          <SectionTitle title="ДАТЫ" />
          <GlassCard padded={false}>
            <InfoRow icon="calendar-outline" label="Дата рождения" value={formatDateOnly(contact.birthDate)} />
            <View style={styles.separator} />
            <InfoRow icon="star-outline" label="Еврейская дата рождения" value={contact.hebrewBirthDate.label} />
          </GlassCard>
        </View>

        <View>
          <SectionTitle title="ЕВРЕЙСКИЙ КАЛЕНДАРЬ" />
          <GlassCard style={styles.birthdayCard}>
            <View style={styles.birthdayContent}>
              <View style={styles.birthdayIcon}>
                <Ionicons name="gift-outline" size={24} color={colors.accent.goldText} />
              </View>
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

        <GlassCard style={styles.privacyCard}>
          <View style={styles.privacyContent}>
            <Ionicons name="lock-closed-outline" size={18} color="#8DBBE8" />
            <Text style={styles.privacyText}>
              Этот контакт хранится только на вашем iPhone и не отправляется в Supabase.
            </Text>
          </View>
        </GlassCard>
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
  sourcePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(74,144,217,0.24)',
    backgroundColor: 'rgba(74,144,217,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 10,
  },
  sourcePillText: {
    color: '#8DBBE8',
    fontSize: 11,
    fontWeight: '700',
    includeFontPadding: false,
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
  birthdayCard: {
    borderColor: 'rgba(255,200,50,0.14)',
    backgroundColor: 'rgba(255,200,50,0.05)',
  },
  birthdayContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  birthdayIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.14)',
    backgroundColor: 'rgba(255,200,50,0.07)',
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
  privacyCard: {
    borderColor: 'rgba(74,144,217,0.20)',
    backgroundColor: 'rgba(74,144,217,0.08)',
  },
  privacyContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  privacyText: {
    flex: 1,
    color: colors.textGhost,
    fontSize: 13,
    lineHeight: 18,
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
