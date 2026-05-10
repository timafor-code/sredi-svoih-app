import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BlessingLanguageTabs } from '@/components/blessings/BlessingLanguageTabs';
import { BlessingTextNusachTabs } from '@/components/blessings/BlessingTextNusachTabs';
import { BlessingTranslitNusachTabs } from '@/components/blessings/BlessingTranslitNusachTabs';
import { GlassCard } from '@/components/glass/GlassCard';
import { supportsBlessingReaderMode } from '@/lib/blessingReaderMode';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import type {
  BlessingContentBlock,
  BlessingLanguage,
  BlessingTextResult,
  BlessingTextNusach,
  BlessingTranslitNusach,
} from '@/types/blessing';

type BlessingTextModalProps = {
  onClose: () => void;
  onLanguageChange: (language: BlessingLanguage) => void;
  onTextNusachChange: (value: BlessingTextNusach) => void;
  onTranslitNusachChange: (value: BlessingTranslitNusach) => void;
  selectedLanguage: BlessingLanguage;
  selectedTextNusach: BlessingTextNusach;
  selectedTranslitNusach: BlessingTranslitNusach;
  textResult: BlessingTextResult | null;
  visible: boolean;
};

type BlessingTextOverlayProps = Omit<BlessingTextModalProps, 'visible'>;

type BirkatPrefaceMode = 'hidden' | NonNullable<BlessingContentBlock['prefaceMode']>;

type TextRenderMode = 'dark' | 'reader';

type DisplaySegment = {
  annotationRu?: string;
  body: string;
};

type DisplayBlock = {
  annotationRu?: string;
  body: string;
  collapsibleGroupKey?: string;
  defaultCollapsed?: boolean;
  kind?: BlessingContentBlock['kind'];
  key: string;
  renderVariant?: BlessingContentBlock['renderVariant'];
  segments?: DisplaySegment[];
  titleRu?: string;
};

type ActiveTextContent =
  | {
      blocks: DisplayBlock[];
      kind: 'blocks';
    }
  | {
      kind: 'placeholder';
      message: string;
    };

const languagePlaceholders: Record<BlessingLanguage, string> = {
  he: 'Текст на иврите пока недоступен',
  translit: 'Транслитерация пока недоступна',
  ru: 'Русский перевод пока недоступен',
};

const translitNusachPlaceholders: Record<BlessingTranslitNusach, string> = {
  sephard: 'Сефардская транслитерация пока недоступна',
  ashkenaz: 'Ашкеназская транслитерация пока недоступна',
};

const readerMinFontSize = 22;
const readerMaxFontSize = 50;
const readerFontStep = 2;

function getInitialPrefaceMode(textResult: BlessingTextResult | null): BirkatPrefaceMode {
  return textResult?.defaultTachanunOn ? 'tachanun' : 'no_tachanun';
}

function hasBlockBody(block: BlessingContentBlock): boolean {
  return (
    (typeof block.bodyRu === 'string' && block.bodyRu.trim().length > 0) ||
    Boolean(block.segments?.some((segment) => segment.bodyRu.trim().length > 0))
  );
}

function toDisplayBlock(block: BlessingContentBlock): DisplayBlock {
  return {
    annotationRu: block.annotationRu,
    body: block.bodyRu?.trim() ?? '',
    collapsibleGroupKey: block.collapsibleGroupKey,
    defaultCollapsed: block.defaultCollapsed,
    kind: block.kind,
    key: block.key,
    renderVariant: block.renderVariant,
    segments: block.segments
      ?.map((segment) => ({
        annotationRu: segment.annotationRu,
        body: segment.bodyRu.trim(),
      }))
      .filter((segment) => segment.body.length > 0),
    titleRu: block.titleRu,
  };
}

function getActiveTextContent(
  textResult: BlessingTextResult,
  selectedLanguage: BlessingLanguage,
  selectedTranslitNusach: BlessingTranslitNusach,
  prefaceMode: BirkatPrefaceMode,
): ActiveTextContent {
  const visibleBlocks = getVisibleBlocks(
    textResult.contentBlocks,
    selectedLanguage,
    selectedTranslitNusach,
    prefaceMode,
  );

  const blocks = visibleBlocks.filter(hasBlockBody).map(toDisplayBlock);

  if (blocks.length > 0) {
    return {
      blocks,
      kind: 'blocks',
    };
  }

  return {
    kind: 'placeholder',
    message: getPlaceholderMessage(selectedLanguage, selectedTranslitNusach),
  };
}

function getVisibleBlocks(
  contentBlocks: readonly BlessingContentBlock[],
  selectedLanguage: BlessingLanguage,
  selectedTranslitNusach: BlessingTranslitNusach,
  prefaceMode: BirkatPrefaceMode,
): readonly BlessingContentBlock[] {
  const prefaceFilteredBlocks = contentBlocks.filter((block) =>
    shouldShowPrefaceBlock(block, prefaceMode),
  );

  switch (selectedLanguage) {
    case 'he':
      return prefaceFilteredBlocks.filter((block) => block.language === 'he');
    case 'ru':
      return prefaceFilteredBlocks.filter((block) => !block.language || block.language === 'ru');
    case 'translit':
      return getVisibleTranslitBlocks(prefaceFilteredBlocks, selectedTranslitNusach);
  }
}

function shouldShowPrefaceBlock(
  block: BlessingContentBlock,
  prefaceMode: BirkatPrefaceMode,
): boolean {
  if (!block.prefaceMode) {
    return true;
  }

  return prefaceMode !== 'hidden' && block.prefaceMode === prefaceMode;
}

function getVisibleTranslitBlocks(
  contentBlocks: readonly BlessingContentBlock[],
  selectedTranslitNusach: BlessingTranslitNusach,
): readonly BlessingContentBlock[] {
  const translitBlocks = contentBlocks.filter((block) => block.language === 'translit');

  if (selectedTranslitNusach === 'sephard') {
    const sephardBlocks = translitBlocks.filter(
      (block) => block.translitNusach === 'sephard',
    );

    return sephardBlocks.length > 0
      ? sephardBlocks
      : translitBlocks.filter((block) => !block.translitNusach);
  }

  return translitBlocks.filter((block) => block.translitNusach === 'ashkenaz');
}

function getPlaceholderMessage(
  selectedLanguage: BlessingLanguage,
  selectedTranslitNusach: BlessingTranslitNusach,
): string {
  if (selectedLanguage === 'translit') {
    return translitNusachPlaceholders[selectedTranslitNusach];
  }

  return languagePlaceholders[selectedLanguage];
}

function isInsertBlock(block: DisplayBlock): boolean {
  return block.renderVariant === 'insert' || block.kind === 'insert';
}

function isAnnotationBlock(block: DisplayBlock): boolean {
  return block.renderVariant === 'annotation' || block.kind === 'note';
}

function isManualCollapsibleBlock(block: DisplayBlock): boolean {
  return block.renderVariant === 'manual_collapsible' || Boolean(block.collapsibleGroupKey);
}

function isBirkatHamazonChabadMode(
  textResult: BlessingTextResult,
  selectedTextNusach: BlessingTextNusach,
): boolean {
  return (
    textResult.blessing.slug === 'birkat_hamazon' &&
    (textResult.selectedTextNusach ?? selectedTextNusach) === 'chabad'
  );
}

function getReaderModeLabel(
  selectedLanguage: BlessingLanguage,
  selectedTranslitNusach: BlessingTranslitNusach,
): string {
  switch (selectedLanguage) {
    case 'he':
      return 'Иврит';
    case 'ru':
      return 'Русский';
    case 'translit':
      return selectedTranslitNusach === 'sephard'
        ? 'Транслит · Сефард'
        : 'Транслит · Ашкеназ';
  }
}

export function BlessingTextOverlay({
  onClose,
  onLanguageChange,
  onTextNusachChange,
  onTranslitNusachChange,
  selectedLanguage,
  selectedTextNusach,
  selectedTranslitNusach,
  textResult,
}: BlessingTextOverlayProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const topPadding = insets.top + 8;
  const bottomPadding = Math.max(insets.bottom + 14, 22);
  const availablePanelHeight = Math.max(320, height - topPadding - bottomPadding);
  const panelMaxHeight = Math.min(availablePanelHeight, 720);
  const [expandedManualGroups, setExpandedManualGroups] = useState<Record<string, boolean>>({});
  const [prefaceMode, setPrefaceMode] = useState<BirkatPrefaceMode>(() =>
    getInitialPrefaceMode(textResult),
  );
  const [isReaderOpen, setIsReaderOpen] = useState(false);
  const [readerFontSize, setReaderFontSize] = useState(28);
  const [showReaderAnnotations, setShowReaderAnnotations] = useState(true);
  const isBirkatHamazonChabad =
    !!textResult &&
    isBirkatHamazonChabadMode(textResult, selectedTextNusach);
  const effectiveTextResult = textResult;
  const textNusachVariants = effectiveTextResult?.blessing.nusachVariants ?? [];
  const showTextNusachTabs = textNusachVariants.length > 1;
  const shouldShowTranslitNusachTabs =
    selectedLanguage === 'translit' &&
    (!showTextNusachTabs || selectedTextNusach !== 'beit_sefaradi');
  const activeTranslitNusach: BlessingTranslitNusach = shouldShowTranslitNusachTabs
    ? selectedTranslitNusach
    : 'sephard';
  const showReaderButton = supportsBlessingReaderMode(textResult);
  const showBirkatTachanunTools =
    isBirkatHamazonChabad && (selectedLanguage === 'he' || selectedLanguage === 'translit');
  const showTextTools = showReaderButton || showBirkatTachanunTools;
  const scrollOffset =
    230 +
    (showTextNusachTabs ? 50 : 0) +
    (showTextTools ? 56 : 0);
  const scrollMaxHeight = Math.max(190, panelMaxHeight - scrollOffset);
  const activeContent = effectiveTextResult
    ? getActiveTextContent(
        effectiveTextResult,
        selectedLanguage,
        activeTranslitNusach,
        prefaceMode,
      )
    : null;
  const readerLineHeight = Math.round(
    readerFontSize * (selectedLanguage === 'he' ? 1.6 : 1.42),
  );
  const isTachanunPrefaceEnabled = prefaceMode === 'tachanun';
  const readerModeLabel = getReaderModeLabel(selectedLanguage, activeTranslitNusach);

  function toggleManualGroup(groupKey: string, defaultExpanded: boolean) {
    setExpandedManualGroups((current) => ({
      ...current,
      [groupKey]: !(current[groupKey] ?? defaultExpanded),
    }));
  }

  function adjustReaderFontSize(delta: number) {
    setReaderFontSize((current) =>
      Math.min(readerMaxFontSize, Math.max(readerMinFontSize, current + delta)),
    );
  }

  function setTachanunPrefaceEnabled(enabled: boolean) {
    setPrefaceMode(enabled ? 'tachanun' : 'no_tachanun');
  }

  function renderDisplayBlock(block: DisplayBlock, renderMode: TextRenderMode) {
    const isReader = renderMode === 'reader';
    const isInsert = isInsertBlock(block);
    const isAnnotation = isAnnotationBlock(block);
    const isManualCollapsible = isManualCollapsibleBlock(block);
    const groupKey = block.collapsibleGroupKey ?? block.key;
    const manualDefaultExpanded = block.defaultCollapsed === false;
    const isManualExpanded = expandedManualGroups[groupKey] ?? manualDefaultExpanded;
    const hasSegments = Boolean(block.segments?.length);
    const bodyTextStyle = [
      isReader ? styles.readerBodyText : styles.bodyText,
      selectedLanguage === 'he' &&
        !isAnnotation &&
        (isReader ? styles.readerHebrewText : styles.hebrewBodyText),
      selectedLanguage === 'he' && !isAnnotation && styles.hebrewSiddurText,
      isReader &&
        selectedLanguage !== 'he' &&
        !isAnnotation &&
        styles.readerPlainText,
      isReader &&
        !isAnnotation && {
          fontSize: readerFontSize,
          lineHeight: readerLineHeight,
        },
      isAnnotation &&
        (isReader ? styles.readerAnnotationBodyText : styles.annotationBodyText),
    ];

    if (isReader && isAnnotation && !showReaderAnnotations) {
      return null;
    }

    function renderBodyText(body: string, key: string) {
      return (
        <Text
          key={key}
          selectable
          style={bodyTextStyle}
        >
          {body}
        </Text>
      );
    }

    function renderSegmentedBody() {
      return block.segments?.map((segment, index) => (
        <View
          key={`${block.key}:segment:${index}`}
          style={isReader ? styles.readerSegmentBlock : styles.segmentBlock}
        >
          {segment.annotationRu && (!isReader || showReaderAnnotations) ? (
            <Text
              style={
                isReader ? styles.readerSegmentAnnotationText : styles.segmentAnnotationText
              }
            >
              {segment.annotationRu}
            </Text>
          ) : null}
          {renderBodyText(segment.body, `${block.key}:segment:${index}:body`)}
        </View>
      ));
    }

    if (isManualCollapsible) {
      return (
        <View
          key={block.key}
          style={isReader ? styles.readerManualBlock : styles.manualBlock}
        >
          <Pressable
            accessibilityLabel={block.titleRu ?? 'Раскрыть дополнительный блок'}
            accessibilityRole="button"
            onPress={() => toggleManualGroup(groupKey, manualDefaultExpanded)}
            style={({ pressed }) => [
              isReader ? styles.readerManualHeader : styles.manualHeader,
              pressed && styles.pressed,
            ]}
          >
            <Text
              numberOfLines={2}
              style={isReader ? styles.readerManualTitle : styles.manualTitle}
            >
              {block.titleRu}
            </Text>
            <Ionicons
              name={isManualExpanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={isReader ? '#111111' : colors.goldAccent}
            />
          </Pressable>

          {isManualExpanded ? (
            <View style={isReader ? styles.readerManualContent : styles.manualContent}>
              {block.annotationRu && (!isReader || showReaderAnnotations) ? (
                <Text
                  style={isReader ? styles.readerAnnotationText : styles.annotationText}
                >
                  {block.annotationRu}
                </Text>
              ) : null}
              {hasSegments
                ? renderSegmentedBody()
                : renderBodyText(block.body, `${block.key}:body`)}
            </View>
          ) : null}
        </View>
      );
    }

    return (
      <View
        key={block.key}
        style={[
          isReader ? styles.readerTextBlock : styles.textBlock,
          isInsert && (isReader ? styles.readerInsertBlock : styles.insertBlock),
          isAnnotation && (isReader ? styles.readerAnnotationBlock : styles.annotationBlock),
        ]}
      >
        {block.titleRu ? (
          <View style={styles.blockTitleRow}>
            <Text
              style={[
                isReader ? styles.readerBlockTitle : styles.blockTitle,
                isInsert && (isReader ? styles.readerInsertBlockTitle : styles.insertBlockTitle),
                isAnnotation && (isReader ? styles.readerAnnotationTitle : styles.annotationTitle),
              ]}
            >
              {block.titleRu}
            </Text>
            {isInsert ? (
              <View style={isReader ? styles.readerInsertBadge : styles.insertBadge}>
                <Text
                  style={
                    isReader ? styles.readerInsertBadgeText : styles.insertBadgeText
                  }
                >
                  Вставка
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
        {block.annotationRu && (!isReader || showReaderAnnotations) ? (
          <Text
            style={[
              isReader ? styles.readerAnnotationText : styles.annotationText,
              !isReader && isInsert && styles.insertAnnotationText,
            ]}
          >
            {block.annotationRu}
          </Text>
        ) : null}
        {hasSegments
          ? renderSegmentedBody()
          : renderBodyText(block.body, `${block.key}:body`)}
      </View>
    );
  }

  if (!effectiveTextResult || !activeContent) {
    return null;
  }

  return (
    <View
      style={[
        styles.overlay,
        {
          paddingBottom: bottomPadding,
          paddingTop: topPadding,
        },
      ]}
    >
        <Pressable
          accessibilityLabel="Закрыть текст благословения"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFillObject}
        />

        <GlassCard
          contentStyle={styles.panelContent}
          style={[styles.panel, { maxHeight: panelMaxHeight }]}
        >
            <View style={styles.header}>
              <View style={styles.titleBlock}>
                <Text style={styles.eyebrow}>Благословение</Text>
                <Text numberOfLines={3} style={styles.title}>
                  {effectiveTextResult.blessing.titleRu}
                </Text>
              </View>

              <Pressable
                accessibilityLabel="Закрыть"
                accessibilityRole="button"
                hitSlop={8}
                onPress={onClose}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              >
                <Ionicons name="close" size={20} color={colors.text} />
              </Pressable>
            </View>

            {effectiveTextResult.blessing.descriptionRu ? (
              <Text style={styles.description}>{effectiveTextResult.blessing.descriptionRu}</Text>
            ) : null}

            {showTextNusachTabs ? (
              <BlessingTextNusachTabs
                onValueChange={onTextNusachChange}
                value={selectedTextNusach}
                variants={textNusachVariants}
              />
            ) : null}

            <BlessingLanguageTabs
              onValueChange={onLanguageChange}
              value={selectedLanguage}
            />

            {shouldShowTranslitNusachTabs ? (
              <BlessingTranslitNusachTabs
                onValueChange={onTranslitNusachChange}
                value={selectedTranslitNusach}
              />
            ) : null}

            {showTextTools ? (
              <View style={styles.birkatToolsRow}>
                {showReaderButton ? (
                  <Pressable
                    accessibilityLabel="Открыть режим чтения"
                    accessibilityRole="button"
                    onPress={() => setIsReaderOpen(true)}
                    style={({ pressed }) => [styles.readerOpenButton, pressed && styles.pressed]}
                  >
                    <Ionicons name="book-outline" size={17} color={colors.goldAccent} />
                    <Text numberOfLines={1} style={styles.readerOpenButtonText}>
                      Режим чтения
                    </Text>
                  </Pressable>
                ) : null}

                {showBirkatTachanunTools ? (
                  <View style={styles.tachanunSwitchControl}>
                    <Text numberOfLines={1} style={styles.tachanunSwitchLabel}>
                      Таханун
                    </Text>
                    <Switch
                      accessibilityLabel="Таханун"
                      accessibilityRole="switch"
                      accessibilityState={{ checked: isTachanunPrefaceEnabled }}
                      ios_backgroundColor="rgba(255,255,255,0.20)"
                      onValueChange={setTachanunPrefaceEnabled}
                      thumbColor={
                        Platform.OS === 'android'
                          ? isTachanunPrefaceEnabled
                            ? colors.goldAccent
                            : colors.textMuted
                          : undefined
                      }
                      trackColor={{
                        false: 'rgba(255,255,255,0.20)',
                        true: 'rgba(255,200,50,0.52)',
                      }}
                      value={isTachanunPrefaceEnabled}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}

            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator
              style={[styles.scrollArea, { maxHeight: scrollMaxHeight }]}
            >
              {activeContent.kind === 'blocks' ? (
                activeContent.blocks.map((block) => renderDisplayBlock(block, 'dark'))
              ) : (
                <Text style={styles.placeholderText}>{activeContent.message}</Text>
              )}
            </ScrollView>
        </GlassCard>

        <Modal
          animationType="slide"
          onRequestClose={() => setIsReaderOpen(false)}
          presentationStyle="fullScreen"
          visible={isReaderOpen}
        >
          <View
            style={[
              styles.readerOverlay,
              {
                paddingBottom: Math.max(insets.bottom + 12, 18),
                paddingTop: insets.top + 8,
              },
            ]}
          >
            <View style={styles.readerHeader}>
              <Pressable
                accessibilityLabel="Закрыть режим чтения"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setIsReaderOpen(false)}
                style={({ pressed }) => [styles.readerCloseButton, pressed && styles.pressed]}
              >
                <Ionicons name="close" size={22} color="#111111" />
              </Pressable>

              <View style={styles.readerTitleBlock}>
                <Text numberOfLines={1} style={styles.readerTitle}>
                  {effectiveTextResult.blessing.titleRu}
                </Text>
                <Text numberOfLines={1} style={styles.readerModeLabel}>
                  {readerModeLabel}
                </Text>
              </View>

              <View style={styles.readerFontControls}>
                <Pressable
                  accessibilityLabel="Уменьшить размер текста"
                  accessibilityRole="button"
                  disabled={readerFontSize <= readerMinFontSize}
                  onPress={() => adjustReaderFontSize(-readerFontStep)}
                  style={({ pressed }) => [
                    styles.readerFontButton,
                    readerFontSize <= readerMinFontSize && styles.readerFontButtonDisabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.readerFontButtonText}>A−</Text>
                </Pressable>
                <Text style={styles.readerFontValue}>{readerFontSize}</Text>
                <Pressable
                  accessibilityLabel="Увеличить размер текста"
                  accessibilityRole="button"
                  disabled={readerFontSize >= readerMaxFontSize}
                  onPress={() => adjustReaderFontSize(readerFontStep)}
                  style={({ pressed }) => [
                    styles.readerFontButton,
                    readerFontSize >= readerMaxFontSize && styles.readerFontButtonDisabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.readerFontButtonText}>A+</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.readerToggleRow}>
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: showReaderAnnotations }}
                onPress={() => setShowReaderAnnotations((current) => !current)}
                style={({ pressed }) => [
                  styles.readerAnnotationToggle,
                  showReaderAnnotations && styles.readerAnnotationToggleActive,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  name={showReaderAnnotations ? 'checkbox' : 'square-outline'}
                  size={15}
                  color={showReaderAnnotations ? '#8A5B00' : '#666666'}
                />
                <Text
                  style={[
                    styles.readerAnnotationToggleText,
                    showReaderAnnotations && styles.readerAnnotationToggleTextActive,
                  ]}
                >
                  Аннотации
                </Text>
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.readerScrollContent}
              showsVerticalScrollIndicator
              style={styles.readerScrollArea}
            >
              {activeContent.kind === 'blocks' ? (
                activeContent.blocks.map((block) => renderDisplayBlock(block, 'reader'))
              ) : (
                <Text style={styles.readerPlaceholderText}>{activeContent.message}</Text>
              )}
            </ScrollView>
          </View>
        </Modal>
    </View>
  );
}

export function BlessingTextModal({
  visible,
  onClose,
  ...overlayProps
}: BlessingTextModalProps) {
  if (!visible || !overlayProps.textResult) {
    return null;
  }

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <BlessingTextOverlay onClose={onClose} {...overlayProps} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: 14,
    backgroundColor: 'rgba(0,0,0,0.66)',
  },
  panel: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    borderColor: 'rgba(255,200,50,0.18)',
    backgroundColor: 'rgba(13,15,24,0.94)',
  },
  panelContent: {
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0,
    marginBottom: 5,
  },
  title: {
    color: colors.text,
    fontSize: 23,
    fontWeight: '900',
    lineHeight: 28,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.glass.w08,
  },
  description: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
  },
  birkatToolsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
  },
  readerOpenButton: {
    minHeight: 32,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.26)',
    backgroundColor: 'rgba(255,200,50,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  readerOpenButtonText: {
    flexShrink: 1,
    color: colors.goldAccent,
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 15,
  },
  tachanunSwitchControl: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 'auto',
  },
  tachanunSwitchLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 17,
  },
  scrollArea: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.glass.w04,
  },
  scrollContent: {
    gap: 16,
    padding: 15,
  },
  textBlock: {
    gap: 8,
  },
  segmentBlock: {
    gap: 5,
  },
  segmentAnnotationText: {
    color: 'rgba(255,200,50,0.72)',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  insertBlock: {
    borderRadius: radius.md,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderLeftColor: 'rgba(255,200,50,0.54)',
    borderRightColor: 'rgba(255,200,50,0.18)',
    backgroundColor: 'rgba(255,200,50,0.06)',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  annotationBlock: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.13)',
    backgroundColor: colors.glass.w05,
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  blockTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  blockTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.goldAccent,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  insertBlockTitle: {
    color: colors.goldAccent,
  },
  annotationTitle: {
    color: colors.textMuted,
  },
  insertBadge: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.22)',
    backgroundColor: 'rgba(255,200,50,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  insertBadgeText: {
    color: colors.accent.goldText,
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 13,
  },
  annotationText: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  insertAnnotationText: {
    color: colors.textMuted,
  },
  annotationBodyText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  manualBlock: {
    overflow: 'hidden',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.11)',
    backgroundColor: colors.glass.w05,
  },
  manualHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  manualTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  manualContent: {
    gap: 9,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 10,
  },
  bodyText: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 25,
  },
  hebrewBodyText: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '400',
    lineHeight: 42,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  hebrewSiddurText: {
    fontFamily: Platform.select({
      ios: 'Times New Roman',
      default: undefined,
    }),
  },
  placeholderText: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 22,
  },
  readerOverlay: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
  },
  readerHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  readerCloseButton: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(17,17,17,0.14)',
    backgroundColor: '#FFFFFF',
  },
  readerTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  readerTitle: {
    color: '#111111',
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 23,
  },
  readerModeLabel: {
    color: '#666666',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 15,
  },
  readerFontControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  readerFontButton: {
    minWidth: 38,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(17,17,17,0.16)',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
  },
  readerFontButtonDisabled: {
    opacity: 0.38,
  },
  readerFontButtonText: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 18,
  },
  readerFontValue: {
    minWidth: 26,
    color: '#111111',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
    textAlign: 'center',
  },
  readerToggleRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 8,
  },
  readerAnnotationToggle: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(17,17,17,0.14)',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  readerAnnotationToggleActive: {
    borderColor: 'rgba(180,130,0,0.30)',
    backgroundColor: '#FFF8E6',
  },
  readerAnnotationToggleText: {
    color: '#666666',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
  },
  readerAnnotationToggleTextActive: {
    color: '#8A5B00',
  },
  readerScrollArea: {
    flex: 1,
  },
  readerScrollContent: {
    gap: 18,
    paddingBottom: 28,
    paddingTop: 8,
  },
  readerTextBlock: {
    gap: 8,
  },
  readerSegmentBlock: {
    gap: 5,
  },
  readerSegmentAnnotationText: {
    color: '#666666',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  readerInsertBlock: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(180,130,0,0.25)',
    backgroundColor: '#FFF8E6',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  readerAnnotationBlock: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(17,17,17,0.10)',
    backgroundColor: '#F7F7F7',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  readerBlockTitle: {
    flex: 1,
    minWidth: 0,
    color: '#8A5B00',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  readerInsertBlockTitle: {
    color: '#8A5B00',
  },
  readerAnnotationTitle: {
    color: '#666666',
  },
  readerInsertBadge: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(180,130,0,0.24)',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  readerInsertBadgeText: {
    color: '#8A5B00',
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 13,
  },
  readerAnnotationText: {
    color: '#666666',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  readerAnnotationBodyText: {
    color: '#666666',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  readerBodyText: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 25,
  },
  readerHebrewText: {
    color: '#111111',
    fontWeight: '400',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  readerPlainText: {
    color: '#111111',
    fontWeight: '400',
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  readerManualBlock: {
    overflow: 'hidden',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(17,17,17,0.14)',
    backgroundColor: '#FFFFFF',
  },
  readerManualHeader: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  readerManualTitle: {
    flex: 1,
    minWidth: 0,
    color: '#111111',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  readerManualContent: {
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,17,17,0.12)',
    paddingHorizontal: 12,
    paddingBottom: 13,
    paddingTop: 11,
  },
  readerPlaceholderText: {
    color: '#666666',
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 22,
  },
  pressed: {
    opacity: 0.78,
  },
});
