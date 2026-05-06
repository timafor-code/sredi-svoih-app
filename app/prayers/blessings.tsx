import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { BlessingDirectCard } from '@/components/blessings/BlessingDirectCard';
import { BlessingHomeGroup } from '@/components/blessings/BlessingHomeGroup';
import { BlessingItemSchemeCard } from '@/components/blessings/BlessingItemSchemeCard';
import { BlessingSearchBar } from '@/components/blessings/BlessingSearchBar';
import { BlessingSearchResults } from '@/components/blessings/BlessingSearchResults';
import { BlessingTextModal } from '@/components/blessings/BlessingTextModal';
import { Screen } from '@/components/ui/Screen';
import {
  getBlessingItemDetails,
  getBlessingText,
  listHomeBlessings,
  searchBlessings,
} from '@/services/blessingsCatalogService';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import type {
  Blessing,
  BlessingHomeGroup as BlessingHomeGroupKey,
  BlessingItemDetails,
  BlessingLanguage,
  BlessingResolvedStep,
  BlessingSearchResult,
  BlessingTextResult,
} from '@/types/blessing';

const homeGroupLabels: Record<BlessingHomeGroupKey, string> = {
  before_food: 'До еды',
  after_food: 'После',
  various: 'Различные благословения',
};

const homeGroupOrder: readonly BlessingHomeGroupKey[] = ['before_food', 'after_food', 'various'];

export default function BlessingsScreen() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBlessingSlug, setSelectedBlessingSlug] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<BlessingLanguage>('ru');
  const [selectedItemDetails, setSelectedItemDetails] = useState<BlessingItemDetails | null>(null);
  const [modalLanguage, setModalLanguage] = useState<BlessingLanguage>('ru');
  const [modalTextResult, setModalTextResult] = useState<BlessingTextResult | null>(null);
  const homeBlessings = useMemo(() => listHomeBlessings(), []);
  const hasSearchQuery = searchQuery.trim().length > 0;
  const searchResults = useMemo(
    () => (hasSearchQuery ? searchBlessings(searchQuery) : []),
    [hasSearchQuery, searchQuery],
  );
  const selectedBlessingText = useMemo(
    () =>
      selectedBlessingSlug
        ? getBlessingText(selectedBlessingSlug, { language: selectedLanguage })
        : null,
    [selectedBlessingSlug, selectedLanguage],
  );

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setSelectedItemDetails(null);
    setSelectedBlessingSlug(null);
  };

  const openBlessingText = (blessingSlug: string, initialLanguage?: BlessingLanguage) => {
    const language = initialLanguage ?? modalLanguage;
    const textResult = getBlessingText(blessingSlug, { language });

    if (!textResult) {
      Alert.alert('Текст недоступен', 'Текст для этого благословения пока недоступен');
      return;
    }

    setModalLanguage(language);
    setModalTextResult(textResult);
  };

  const closeBlessingText = () => {
    setModalTextResult(null);
  };

  const handleModalLanguageChange = (language: BlessingLanguage) => {
    setModalLanguage(language);

    const blessingSlug = modalTextResult?.blessing.slug;

    if (!blessingSlug) {
      return;
    }

    const textResult = getBlessingText(blessingSlug, { language });

    if (textResult) {
      setModalTextResult(textResult);
    }
  };

  const handleHomeBlessingPress = (blessing: Blessing) => {
    openBlessingText(blessing.slug, 'ru');
  };

  const handleSearchResultPress = (result: BlessingSearchResult) => {
    if (result.resultType === 'item') {
      setSelectedBlessingSlug(null);
      setSelectedItemDetails(null);

      const details = getBlessingItemDetails(result.slug);

      if (!details) {
        Alert.alert(result.titleRu, 'Схема для этого продукта пока недоступна');
        return;
      }

      setSelectedItemDetails(details);
      return;
    }

    if (result.resultType === 'blessing') {
      const textResult = getBlessingText(result.slug, { language: selectedLanguage });

      if (!textResult) {
        setSelectedItemDetails(null);
        setSelectedBlessingSlug(null);
        Alert.alert(result.titleRu, 'Текст для этого благословения пока недоступен');
        return;
      }

      setSelectedItemDetails(null);
      setSelectedBlessingSlug(result.slug);
      return;
    }

    Alert.alert(result.titleRu, 'Категории будут добавлены следующим PR');
  };

  const handleStepPress = (step: BlessingResolvedStep) => {
    openBlessingText(step.blessingSlug, 'ru');
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

      <BlessingSearchBar value={searchQuery} onChangeText={handleSearchChange} />

      {hasSearchQuery ? (
        <View style={styles.searchStack}>
          <BlessingSearchResults
            onResultPress={handleSearchResultPress}
            query={searchQuery}
            results={searchResults}
            selectedBlessingSlug={selectedBlessingSlug}
            selectedItemSlug={selectedItemDetails?.item.slug}
          />
          {selectedItemDetails ? (
            <BlessingItemSchemeCard
              details={selectedItemDetails}
              onStepPress={handleStepPress}
            />
          ) : null}
          {selectedBlessingText ? (
            <BlessingDirectCard
              onLanguageChange={setSelectedLanguage}
              onOpenText={() =>
                openBlessingText(selectedBlessingText.blessing.slug, selectedLanguage)
              }
              selectedLanguage={selectedLanguage}
              textResult={selectedBlessingText}
            />
          ) : null}
        </View>
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
      <BlessingTextModal
        onClose={closeBlessingText}
        onLanguageChange={handleModalLanguageChange}
        selectedLanguage={modalLanguage}
        textResult={modalTextResult}
        visible={modalTextResult !== null}
      />
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
  searchStack: {
    gap: 14,
  },
  quickAccessLabel: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
  },
});
