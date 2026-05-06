import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { BlessingHomeGroup } from '@/components/blessings/BlessingHomeGroup';
import { BlessingSearchBar } from '@/components/blessings/BlessingSearchBar';
import { GlassCard } from '@/components/glass/GlassCard';
import { Screen } from '@/components/ui/Screen';
import { listHomeBlessings } from '@/services/blessingsCatalogService';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import type { Blessing, BlessingHomeGroup as BlessingHomeGroupKey } from '@/types/blessing';

const homeGroupLabels: Record<BlessingHomeGroupKey, string> = {
  before_food: 'До еды',
  after_food: 'После',
  various: 'Различные благословения',
};

const homeGroupOrder: readonly BlessingHomeGroupKey[] = ['before_food', 'after_food', 'various'];

export default function BlessingsScreen() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const homeBlessings = useMemo(() => listHomeBlessings(), []);
  const hasSearchQuery = searchQuery.trim().length > 0;

  const handleHomeBlessingPress = (blessing: Blessing) => {
    Alert.alert(blessing.titleRu, 'Текст благословения будет добавлен следующим PR');
  };

  return (
    <Screen contentContainerStyle={styles.content}>
      <LinearGradient
        colors={['rgba(246,164,0,0.12)', 'rgba(6,8,16,0)']}
        end={{ x: 0.85, y: 1 }}
        start={{ x: 0.2, y: 0 }}
        style={styles.topGlow}
        pointerEvents="none"
      />

      <View style={styles.navRow}>
        <Pressable
          accessibilityLabel="Назад"
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={18} color={colors.orange} />
          <Text style={styles.backText}>Назад</Text>
        </Pressable>
      </View>

      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <LinearGradient
            colors={['rgba(255,200,50,0.20)', 'rgba(240,122,42,0.08)']}
            style={StyleSheet.absoluteFillObject}
          />
          <Ionicons name="book-outline" size={27} color={colors.goldAccent} />
        </View>
        <View style={styles.heroText}>
          <Text style={styles.title}>Благословения</Text>
          <Text style={styles.subtitle}>
            Введите продукт или действие, чтобы найти нужные благословения
          </Text>
        </View>
      </View>

      <BlessingSearchBar value={searchQuery} onChangeText={setSearchQuery} />

      {hasSearchQuery ? (
        <GlassCard style={styles.searchPlaceholder}>
          <View style={styles.placeholderIcon}>
            <Ionicons name="search" size={22} color={colors.goldAccent} />
          </View>
          <Text style={styles.placeholderTitle}>Поиск будет добавлен следующим PR</Text>
          <Text style={styles.placeholderText}>
            Сейчас доступен быстрый переход к основным благословениям.
          </Text>
        </GlassCard>
      ) : (
        <View style={styles.quickAccess}>
          <Text style={styles.quickAccessLabel}>Быстрый доступ · Нажмите, чтобы открыть текст</Text>
          {homeGroupOrder.map((group) => (
            <BlessingHomeGroup
              key={group}
              blessings={homeBlessings[group]}
              group={group}
              onBlessingPress={handleHomeBlessingPress}
              title={homeGroupLabels[group]}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
  },
  topGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 190,
  },
  navRow: {
    minHeight: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backButton: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.full,
    paddingRight: 12,
  },
  backText: {
    color: colors.orange,
    fontSize: 16,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.72,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  heroIcon: {
    width: 58,
    height: 58,
    overflow: 'hidden',
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.24)',
    backgroundColor: colors.accent.goldBg,
  },
  heroText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.text,
    fontSize: 31,
    fontWeight: '800',
    letterSpacing: 0,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 5,
  },
  quickAccess: {
    gap: 14,
  },
  quickAccessLabel: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
  },
  searchPlaceholder: {
    borderColor: 'rgba(255,200,50,0.16)',
  },
  placeholderIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.20)',
    backgroundColor: colors.accent.goldBg,
    marginBottom: 12,
  },
  placeholderTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  placeholderText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
});
