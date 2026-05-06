import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { type Href, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';

const blessingsRoute = '/prayers/blessings' as Href;

export function BlessingsEntryCard() {
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Открыть раздел Благословения"
      onPress={() => router.push(blessingsRoute)}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
    >
      <GlassCard style={styles.card} contentStyle={styles.content}>
        <LinearGradient
          colors={['rgba(246,164,0,0.14)', 'rgba(240,122,42,0.055)', 'rgba(255,255,255,0)']}
          end={{ x: 1, y: 1 }}
          start={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={styles.accentLine} />
        <View style={styles.row}>
          <View style={styles.iconBox}>
            <LinearGradient
              colors={['rgba(255,200,50,0.18)', 'rgba(240,122,42,0.10)']}
              style={StyleSheet.absoluteFillObject}
            />
            <Ionicons name="book-outline" size={24} color={colors.goldAccent} />
            <View style={styles.foodBadge}>
              <Ionicons name="restaurant-outline" size={13} color={colors.orange} />
            </View>
            <View style={styles.searchBadge}>
              <Ionicons name="search" size={12} color={colors.text} />
            </View>
          </View>

          <View style={styles.textBlock}>
            <Text numberOfLines={1} style={styles.title}>
              Благословения
            </Text>
            <Text numberOfLines={2} style={styles.subtitle}>
              Найдите нужное благословение по продукту или действию
            </Text>
          </View>

          <View style={styles.cta}>
            <Text numberOfLines={1} style={styles.ctaText}>
              Открыть
            </Text>
            <Ionicons name="chevron-forward" size={15} color={colors.goldAccent} />
          </View>
        </View>
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    shadowColor: colors.orange,
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  pressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
  card: {
    borderColor: 'rgba(255,200,50,0.20)',
    backgroundColor: 'rgba(246,164,0,0.045)',
  },
  content: {
    position: 'relative',
    padding: 15,
  },
  accentLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 3,
    backgroundColor: colors.gold,
    opacity: 0.78,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBox: {
    width: 50,
    height: 50,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.28)',
    backgroundColor: colors.accent.goldBg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  foodBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 18,
    height: 18,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(240,122,42,0.36)',
    backgroundColor: 'rgba(240,122,42,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBadge: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    width: 18,
    height: 18,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(6,8,16,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    includeFontPadding: false,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 5,
  },
  cta: {
    minHeight: 32,
    maxWidth: 94,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.22)',
    backgroundColor: 'rgba(255,200,50,0.11)',
    paddingHorizontal: 9,
  },
  ctaText: {
    color: colors.goldAccent,
    fontSize: 12,
    fontWeight: '700',
    includeFontPadding: false,
  },
});
