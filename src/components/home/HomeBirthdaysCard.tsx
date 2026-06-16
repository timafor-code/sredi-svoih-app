import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { HomeSectionTitle } from '@/components/home/HomeSectionTitle';
import { Avatar } from '@/components/ui/Avatar';
import { colors } from '@/theme/colors';
import type { ContactSource } from '@/types/contact';

export type HomeBirthdayCardItem = {
  active: boolean;
  bg: string;
  contactId: string;
  hebrew: string;
  id: string;
  initials: string;
  name: string;
  source: ContactSource;
  when: string;
};

type HomeBirthdaysCardProps = {
  error: boolean;
  items: HomeBirthdayCardItem[];
  loading: boolean;
  onBirthdayPress: (item: HomeBirthdayCardItem) => void;
};

function BirthdayRow({
  isLast,
  item,
  onPress,
}: {
  isLast?: boolean;
  item: HomeBirthdayCardItem;
  onPress: (item: HomeBirthdayCardItem) => void;
}) {
  return (
    <Pressable
      accessibilityLabel={item.name}
      accessibilityRole="button"
      hitSlop={4}
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.birthdayRow, !isLast && styles.rowDivider, pressed && styles.rowPressed]}
    >
      <Avatar initials={item.initials} bg={item.bg} size={40} />
      <View style={styles.birthdayContent}>
        <View style={styles.flex}>
          <Text numberOfLines={1} style={styles.birthdayName}>{item.name}</Text>
          <Text numberOfLines={1} style={styles.birthdayHebrew}>{item.hebrew}</Text>
        </View>
        <Text numberOfLines={2} style={[styles.birthdayWhen, item.active && styles.birthdayToday]}>
          {item.when}
        </Text>
      </View>
    </Pressable>
  );
}

export function HomeBirthdaysCard({
  error,
  items,
  loading,
  onBirthdayPress,
}: HomeBirthdaysCardProps) {
  return (
    <View style={styles.section}>
      <HomeSectionTitle title="ДНИ РОЖДЕНИЯ · КОНТАКТЫ" action="Все контакты →" />
      <GlassCard padded={false}>
        {loading ? (
          <View style={styles.birthdayState}>
            <Text numberOfLines={2} style={styles.birthdayStateText}>Загружаем дни рождения…</Text>
          </View>
        ) : error ? (
          <View style={styles.birthdayState}>
            <Text numberOfLines={2} style={styles.birthdayStateText}>Не удалось загрузить контакты</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.birthdayState}>
            <Text numberOfLines={2} style={styles.birthdayStateText}>Ближайшие дни рождения не найдены</Text>
          </View>
        ) : (
          items.map((item, index) => (
            <BirthdayRow
              key={item.id}
              item={item}
              isLast={index === items.length - 1}
              onPress={onBirthdayPress}
            />
          ))
        )}
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
  },
  birthdayRow: {
    minHeight: 64,
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
  rowPressed: {
    backgroundColor: colors.glass.w06,
  },
  birthdayContent: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  birthdayName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  birthdayHebrew: {
    color: colors.textGhost,
    fontSize: 12,
    fontStyle: 'italic',
    lineHeight: 16,
    marginTop: 2,
  },
  birthdayWhen: {
    flexShrink: 0,
    maxWidth: 92,
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 17,
    textAlign: 'right',
  },
  birthdayToday: {
    color: colors.orange,
  },
  birthdayState: {
    minHeight: 58,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  birthdayStateText: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
});
