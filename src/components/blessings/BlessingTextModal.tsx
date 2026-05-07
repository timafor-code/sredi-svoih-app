import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BlessingLanguageTabs } from '@/components/blessings/BlessingLanguageTabs';
import { BlessingTextNusachTabs } from '@/components/blessings/BlessingTextNusachTabs';
import { BlessingTranslitNusachTabs } from '@/components/blessings/BlessingTranslitNusachTabs';
import { GlassCard } from '@/components/glass/GlassCard';
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

type DisplayBlock = {
  annotationRu?: string;
  body: string;
  collapsibleGroupKey?: string;
  defaultCollapsed?: boolean;
  kind?: BlessingContentBlock['kind'];
  key: string;
  renderVariant?: BlessingContentBlock['renderVariant'];
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
  he: 'Текст на иврите будет добавлен после проверки',
  translit: 'Сефардская транслитерация будет добавлена после проверки',
  ru: 'Текст требует проверки и будет добавлен позже',
};

const translitNusachPlaceholders: Record<BlessingTranslitNusach, string> = {
  sephard: 'Сефардская транслитерация будет добавлена после проверки',
  ashkenaz: 'Ашкеназская транслитерация будет добавлена после проверки',
};

function hasBlockBody(block: BlessingContentBlock): block is BlessingContentBlock & { bodyRu: string } {
  return typeof block.bodyRu === 'string' && block.bodyRu.trim().length > 0;
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
    titleRu: block.titleRu,
  };
}

function getActiveTextContent(
  textResult: BlessingTextResult,
  selectedLanguage: BlessingLanguage,
  selectedTranslitNusach: BlessingTranslitNusach,
): ActiveTextContent {
  const visibleBlocks = getVisibleBlocks(
    textResult.contentBlocks,
    selectedLanguage,
    selectedTranslitNusach,
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
): readonly BlessingContentBlock[] {
  switch (selectedLanguage) {
    case 'he':
      return contentBlocks.filter((block) => block.language === 'he');
    case 'ru':
      return contentBlocks.filter((block) => !block.language || block.language === 'ru');
    case 'translit':
      return getVisibleTranslitBlocks(contentBlocks, selectedTranslitNusach);
  }
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
  const showVerificationNotice =
    !!textResult && (textResult.blessing.needsVerification || textResult.needsVerification);
  const textNusachVariants = textResult?.blessing.nusachVariants ?? [];
  const showTextNusachTabs = textNusachVariants.length > 1;
  const shouldShowTranslitNusachTabs =
    selectedLanguage === 'translit' &&
    (!showTextNusachTabs || selectedTextNusach !== 'beit_sefaradi');
  const activeTranslitNusach: BlessingTranslitNusach = shouldShowTranslitNusachTabs
    ? selectedTranslitNusach
    : 'sephard';
  const scrollOffset = (showVerificationNotice ? 286 : 230) + (showTextNusachTabs ? 50 : 0);
  const scrollMaxHeight = Math.max(190, panelMaxHeight - scrollOffset);
  const activeContent = textResult
    ? getActiveTextContent(textResult, selectedLanguage, activeTranslitNusach)
    : null;
  const [expandedManualGroups, setExpandedManualGroups] = useState<Record<string, boolean>>({});

  function toggleManualGroup(groupKey: string, defaultExpanded: boolean) {
    setExpandedManualGroups((current) => ({
      ...current,
      [groupKey]: !(current[groupKey] ?? defaultExpanded),
    }));
  }

  if (!textResult || !activeContent) {
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
                  {textResult.blessing.titleRu}
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

            {textResult.blessing.descriptionRu ? (
              <Text style={styles.description}>{textResult.blessing.descriptionRu}</Text>
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

            {showVerificationNotice ? (
              <View style={styles.notice}>
                <Ionicons name="information-circle-outline" size={18} color={colors.goldAccent} />
                <Text style={styles.noticeText}>
                  Текст требует проверки. Полная версия будет добавлена после сверки источника.
                </Text>
              </View>
            ) : null}

            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator
              style={[styles.scrollArea, { maxHeight: scrollMaxHeight }]}
            >
              {activeContent.kind === 'blocks' ? (
                activeContent.blocks.map((block) => {
                  const isInsert = isInsertBlock(block);
                  const isAnnotation = isAnnotationBlock(block);
                  const isManualCollapsible = isManualCollapsibleBlock(block);
                  const groupKey = block.collapsibleGroupKey ?? block.key;
                  const manualDefaultExpanded = block.defaultCollapsed === false;
                  const isManualExpanded =
                    expandedManualGroups[groupKey] ?? manualDefaultExpanded;

                  if (isManualCollapsible) {
                    return (
                      <View key={block.key} style={styles.manualBlock}>
                        <Pressable
                          accessibilityLabel={block.titleRu ?? 'Раскрыть дополнительный блок'}
                          accessibilityRole="button"
                          onPress={() => toggleManualGroup(groupKey, manualDefaultExpanded)}
                          style={({ pressed }) => [
                            styles.manualHeader,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Text numberOfLines={2} style={styles.manualTitle}>
                            {block.titleRu}
                          </Text>
                          <Ionicons
                            name={isManualExpanded ? 'chevron-up' : 'chevron-down'}
                            size={18}
                            color={colors.goldAccent}
                          />
                        </Pressable>

                        {isManualExpanded ? (
                          <View style={styles.manualContent}>
                            {block.annotationRu ? (
                              <Text style={styles.annotationText}>{block.annotationRu}</Text>
                            ) : null}
                            <Text
                              selectable
                              style={[
                                styles.bodyText,
                                selectedLanguage === 'he' && styles.hebrewBodyText,
                                selectedLanguage === 'he' && styles.hebrewSiddurText,
                              ]}
                            >
                              {block.body}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    );
                  }

                  return (
                    <View
                      key={block.key}
                      style={[
                        styles.textBlock,
                        isInsert && styles.insertBlock,
                        isAnnotation && styles.annotationBlock,
                      ]}
                    >
                      {block.titleRu ? (
                        <View style={styles.blockTitleRow}>
                          <Text
                            style={[
                              styles.blockTitle,
                              isInsert && styles.insertBlockTitle,
                              isAnnotation && styles.annotationTitle,
                            ]}
                          >
                            {block.titleRu}
                          </Text>
                          {isInsert ? (
                            <View style={styles.insertBadge}>
                              <Text style={styles.insertBadgeText}>Вставка</Text>
                            </View>
                          ) : null}
                        </View>
                      ) : null}
                      {block.annotationRu ? (
                        <Text
                          style={[
                            styles.annotationText,
                            isInsert && styles.insertAnnotationText,
                          ]}
                        >
                          {block.annotationRu}
                        </Text>
                      ) : null}
                      <Text
                        selectable
                        style={[
                          styles.bodyText,
                          selectedLanguage === 'he' &&
                            !isAnnotation &&
                            styles.hebrewBodyText,
                          selectedLanguage === 'he' &&
                            !isAnnotation &&
                            styles.hebrewSiddurText,
                          isAnnotation && styles.annotationBodyText,
                        ]}
                      >
                        {block.body}
                      </Text>
                    </View>
                  );
                })
              ) : (
                <Text style={styles.placeholderText}>{activeContent.message}</Text>
              )}
            </ScrollView>
        </GlassCard>
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
  notice: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.18)',
    backgroundColor: 'rgba(255,200,50,0.07)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noticeText: {
    flex: 1,
    minWidth: 0,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
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
  pressed: {
    opacity: 0.78,
  },
});
