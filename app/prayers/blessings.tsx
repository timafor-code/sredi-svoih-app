import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { BlessingHomeGroup } from '@/components/blessings/BlessingHomeGroup';
import { BlessingItemSchemeModal } from '@/components/blessings/BlessingItemSchemeModal';
import { BlessingSearchBar } from '@/components/blessings/BlessingSearchBar';
import { BlessingSearchResults } from '@/components/blessings/BlessingSearchResults';
import { BlessingTextModal, BlessingTextOverlay } from '@/components/blessings/BlessingTextModal';
import { Screen } from '@/components/ui/Screen';
import {
  getDisplayModeLanguage,
  getDisplayModeTransliterationStyle,
  normalizeDisplayModeForTextNusach,
} from '@/lib/blessingTextDisplayMode';
import { resolveBlessingUserPreferences } from '@/lib/blessingUserPreferences';
import { resolveJewishCalendarFlags } from '@/lib/jewishCalendarFlags';
import {
  getBlessingItemDetails,
  getBlessingText,
  listHomeBlessings,
  searchBlessings,
} from '@/services/blessingsCatalogService';
import { useAuthStore } from '@/store/useAuthStore';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import type {
  Blessing,
  BlessingHomeGroup as BlessingHomeGroupKey,
  BlessingItemDetails,
  BlessingResolvedStep,
  BlessingSearchResult,
  BlessingTextDisplayMode,
  BlessingTextResult,
  BlessingTextNusach,
} from '@/types/blessing';

const homeGroupLabels: Record<BlessingHomeGroupKey, string> = {
  before_food: 'До еды',
  after_food: 'После',
  various: 'Различные благословения',
};

const homeGroupOrder: readonly BlessingHomeGroupKey[] = ['before_food', 'after_food', 'various'];
type BlessingTextSource = 'direct' | 'scheme';

export default function BlessingsScreen() {
  const router = useRouter();
  const profileNusach = useAuthStore((state) => state.profile?.nusach);
  const blessingUserPreferences = useMemo(
    () => resolveBlessingUserPreferences(profileNusach),
    [profileNusach],
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBlessingSlug, setSelectedBlessingSlug] = useState<string | null>(null);
  const [selectedItemDetails, setSelectedItemDetails] = useState<BlessingItemDetails | null>(null);
  const [modalDisplayMode, setModalDisplayMode] = useState<BlessingTextDisplayMode>('ru');
  const [modalTextNusach, setModalTextNusach] = useState<BlessingTextNusach>(
    blessingUserPreferences.selectedTextNusach,
  );
  const [modalTextResult, setModalTextResult] = useState<BlessingTextResult | null>(null);
  const [modalTextSource, setModalTextSource] = useState<BlessingTextSource | null>(null);
  const calendarFlags = useMemo(() => resolveJewishCalendarFlags(new Date()), []);
  const homeBlessings = useMemo(() => listHomeBlessings(), []);
  const hasSearchQuery = searchQuery.trim().length > 0;
  const searchResults = useMemo(
    () => (hasSearchQuery ? searchBlessings(searchQuery) : []),
    [hasSearchQuery, searchQuery],
  );

  useEffect(() => {
    if (modalTextResult) {
      return;
    }

    setModalTextNusach(blessingUserPreferences.selectedTextNusach);
    setModalDisplayMode((current) => {
      if (current !== 'translit_ashkenaz' && current !== 'translit_sephard') {
        return normalizeDisplayModeForTextNusach(
          current,
          blessingUserPreferences.selectedTextNusach,
        );
      }

      const profileTranslitDisplayMode =
        blessingUserPreferences.translitNusach === 'ashkenaz'
          ? 'translit_ashkenaz'
          : 'translit_sephard';

      return normalizeDisplayModeForTextNusach(
        profileTranslitDisplayMode,
        blessingUserPreferences.selectedTextNusach,
      );
    });
  }, [
    blessingUserPreferences.selectedTextNusach,
    blessingUserPreferences.translitNusach,
    modalTextResult,
  ]);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setSelectedItemDetails(null);
    setSelectedBlessingSlug(null);
  };

  const openBlessingText = (
    blessingSlug: string,
    initialDisplayMode?: BlessingTextDisplayMode,
    source: BlessingTextSource = 'direct',
  ) => {
    const selectedTextNusach = blessingUserPreferences.selectedTextNusach;
    const displayMode = normalizeDisplayModeForTextNusach(
      initialDisplayMode ?? modalDisplayMode,
      selectedTextNusach,
    );
    const language = getDisplayModeLanguage(displayMode);
    const textResult = getBlessingText(blessingSlug, {
      calendarFlags: resolveJewishCalendarFlags(new Date()),
      language,
      selectedTextNusach,
      transliterationStyle: getDisplayModeTransliterationStyle(displayMode),
    });

    if (!textResult) {
      Alert.alert('Текст недоступен', 'Текст для этого благословения пока недоступен');
      return false;
    }

    const resolvedTextNusach = textResult.selectedTextNusach ?? selectedTextNusach;
    setModalDisplayMode(
      normalizeDisplayModeForTextNusach(displayMode, resolvedTextNusach),
    );
    setModalTextNusach(resolvedTextNusach);
    setModalTextResult(textResult);
    setModalTextSource(source);
    return true;
  };

  const closeBlessingText = () => {
    setModalTextResult(null);
    setModalTextSource(null);
  };

  const closeSchemeModal = () => {
    setSelectedItemDetails(null);

    if (modalTextSource === 'scheme') {
      closeBlessingText();
    }
  };

  const handleModalDisplayModeChange = (value: BlessingTextDisplayMode) => {
    const displayMode = normalizeDisplayModeForTextNusach(value, modalTextNusach);
    setModalDisplayMode(displayMode);

    if (!modalTextResult) {
      return;
    }

    const blessingSlug = modalTextResult.blessing.slug;
    const language = getDisplayModeLanguage(displayMode);
    const textResult = getBlessingText(blessingSlug, {
      calendarFlags: modalTextResult.calendarFlags,
      language,
      selectedTextNusach: modalTextNusach,
      transliterationStyle: getDisplayModeTransliterationStyle(displayMode),
    });

    if (textResult) {
      setModalTextResult(textResult);
    }
  };

  const handleModalTextNusachChange = (value: BlessingTextNusach) => {
    const displayMode = normalizeDisplayModeForTextNusach(modalDisplayMode, value);
    setModalTextNusach(value);
    setModalDisplayMode(displayMode);

    if (!modalTextResult) {
      return;
    }

    const blessingSlug = modalTextResult.blessing.slug;
    const language = getDisplayModeLanguage(displayMode);
    const textResult = getBlessingText(blessingSlug, {
      calendarFlags: modalTextResult.calendarFlags,
      language,
      selectedTextNusach: value,
      transliterationStyle: getDisplayModeTransliterationStyle(displayMode),
    });

    if (textResult) {
      setModalTextResult(textResult);
      const resolvedTextNusach = textResult.selectedTextNusach ?? value;
      setModalTextNusach(resolvedTextNusach);
      setModalDisplayMode(
        normalizeDisplayModeForTextNusach(displayMode, resolvedTextNusach),
      );
    }
  };

  const handleHomeBlessingPress = (blessing: Blessing) => {
    openBlessingText(blessing.slug, blessing.displayMode === 'variants' ? 'he' : 'ru');
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
      setSelectedItemDetails(null);
      const didOpenText = openBlessingText(result.slug, 'ru');
      setSelectedBlessingSlug(didOpenText ? result.slug : null);
      return;
    }

    Alert.alert(result.titleRu, 'Категории будут добавлены следующим PR');
  };

  const handleStepPress = (step: BlessingResolvedStep) => {
    openBlessingText(step.blessingSlug, 'ru', 'scheme');
  };

  const isSchemeTextOverlayVisible =
    selectedItemDetails !== null && modalTextResult !== null && modalTextSource === 'scheme';

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
      <BlessingItemSchemeModal
        details={selectedItemDetails}
        onClose={closeSchemeModal}
        onStepPress={handleStepPress}
        overlayContent={
          isSchemeTextOverlayVisible ? (
            <BlessingTextOverlay
              onClose={closeBlessingText}
              onDisplayModeChange={handleModalDisplayModeChange}
              onTextNusachChange={handleModalTextNusachChange}
              selectedDisplayMode={modalDisplayMode}
              selectedTextNusach={modalTextNusach}
              textResult={modalTextResult}
            />
          ) : null
        }
        visible={selectedItemDetails !== null}
      />
      <BlessingTextModal
        onClose={closeBlessingText}
        onDisplayModeChange={handleModalDisplayModeChange}
        onTextNusachChange={handleModalTextNusachChange}
        selectedDisplayMode={modalDisplayMode}
        selectedTextNusach={modalTextNusach}
        textResult={modalTextResult}
        visible={modalTextResult !== null && modalTextSource !== 'scheme'}
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
