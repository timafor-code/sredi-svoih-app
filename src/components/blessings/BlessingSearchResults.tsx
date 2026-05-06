import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import type { BlessingSearchResult, BlessingSearchResultType } from '@/types/blessing';

type IoniconName = keyof typeof Ionicons.glyphMap;

type BlessingSearchResultsProps = {
  onResultPress: (result: BlessingSearchResult) => void;
  query: string;
  results: readonly BlessingSearchResult[];
  selectedItemSlug?: string | null;
};

const resultTypeLabels: Record<BlessingSearchResultType, string> = {
  item: 'Продукт / ситуация',
  blessing: 'Благословение',
  category: 'Категория',
};

function getResultIcon(resultType: BlessingSearchResultType): IoniconName {
  switch (resultType) {
    case 'item':
      return 'restaurant-outline';
    case 'blessing':
      return 'book-outline';
    case 'category':
      return 'folder-open-outline';
  }
}

function hasConditionBadge(result: BlessingSearchResult) {
  return result.complexity === 'conditional' || result.complexity === 'complex';
}

export function BlessingSearchResults({
  onResultPress,
  query,
  results,
  selectedItemSlug,
}: BlessingSearchResultsProps) {
  if (results.length === 0) {
    return (
      <GlassCard style={styles.emptyCard}>
        <View style={styles.emptyIcon}>
          <Ionicons name="search" size={21} color={colors.goldAccent} />
        </View>
        <Text style={styles.emptyTitle}>Ничего не найдено</Text>
        <Text style={styles.emptyText}>Попробуйте другой продукт или название благословения.</Text>
      </GlassCard>
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Результаты</Text>
        <Text numberOfLines={1} style={styles.headerCount}>
          {results.length} по запросу "{query.trim()}"
        </Text>
      </View>

      <GlassCard padded={false} style={styles.resultsCard}>
        {results.map((result, index) => {
          const isSelected = result.resultType === 'item' && selectedItemSlug === result.slug;

          return (
            <Pressable
              accessibilityLabel={result.titleRu}
              accessibilityRole="button"
              key={`${result.resultType}-${result.slug}`}
              onPress={() => onResultPress(result)}
              style={({ pressed }) => [
                styles.row,
                isSelected && styles.selectedRow,
                index !== results.length - 1 && styles.rowDivider,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.iconBox}>
                <Ionicons
                  name={getResultIcon(result.resultType)}
                  size={19}
                  color={colors.goldAccent}
                />
              </View>

              <View style={styles.textBlock}>
                <Text numberOfLines={1} style={styles.title}>
                  {result.titleRu}
                </Text>
                <View style={styles.metaRow}>
                  <Text numberOfLines={1} style={styles.typeLabel}>
                    {resultTypeLabels[result.resultType]}
                  </Text>
                  {hasConditionBadge(result) ? (
                    <View style={styles.conditionBadge}>
                      <Ionicons name="alert-circle-outline" size={12} color={colors.goldAccent} />
                      <Text numberOfLines={1} style={styles.conditionText}>
                        Есть условия
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text numberOfLines={1} style={styles.matchedText}>
                  Найдено по: {result.matchedText}
                </Text>
              </View>

              <Ionicons name="chevron-forward" size={17} color="rgba(255,255,255,0.26)" />
            </Pressable>
          );
        })}
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 2,
  },
  headerTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '900',
  },
  headerCount: {
    flexShrink: 1,
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '700',
  },
  resultsCard: {
    borderColor: colors.borderStrong,
  },
  row: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  selectedRow: {
    backgroundColor: 'rgba(255,200,50,0.075)',
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  pressed: {
    opacity: 0.78,
    backgroundColor: colors.glass.w04,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.24)',
    backgroundColor: 'rgba(255,200,50,0.105)',
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    includeFontPadding: false,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  typeLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  conditionBadge: {
    maxWidth: 108,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,159,10,0.32)',
    backgroundColor: colors.accent.orangeBg,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  conditionText: {
    flexShrink: 1,
    color: colors.goldAccent,
    fontSize: 10,
    fontWeight: '900',
  },
  matchedText: {
    color: colors.textGhost,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 5,
  },
  emptyCard: {
    borderColor: 'rgba(255,200,50,0.16)',
  },
  emptyIcon: {
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
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
});
