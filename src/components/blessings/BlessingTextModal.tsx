import { Ionicons } from '@expo/vector-icons';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BlessingLanguageTabs } from '@/components/blessings/BlessingLanguageTabs';
import { BlessingTranslitNusachTabs } from '@/components/blessings/BlessingTranslitNusachTabs';
import { GlassCard } from '@/components/glass/GlassCard';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import type {
  BlessingContentBlock,
  BlessingLanguage,
  BlessingTextResult,
  BlessingTranslitNusach,
} from '@/types/blessing';

type BlessingTextModalProps = {
  onClose: () => void;
  onLanguageChange: (language: BlessingLanguage) => void;
  onTranslitNusachChange: (value: BlessingTranslitNusach) => void;
  selectedLanguage: BlessingLanguage;
  selectedTranslitNusach: BlessingTranslitNusach;
  textResult: BlessingTextResult | null;
  visible: boolean;
};

type DisplayBlock = {
  body: string;
  kind?: BlessingContentBlock['kind'];
  key: string;
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
    body: block.bodyRu?.trim() ?? '',
    kind: block.kind,
    key: block.key,
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

export function BlessingTextModal({
  onClose,
  onLanguageChange,
  onTranslitNusachChange,
  selectedLanguage,
  selectedTranslitNusach,
  textResult,
  visible,
}: BlessingTextModalProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const panelMaxHeight = Math.max(
    360,
    Math.min(height - insets.top - insets.bottom - 42, 720),
  );
  const showVerificationNotice =
    !!textResult && (textResult.blessing.needsVerification || textResult.needsVerification);
  const scrollMaxHeight = Math.max(190, panelMaxHeight - (showVerificationNotice ? 286 : 230));
  const activeContent = textResult
    ? getActiveTextContent(textResult, selectedLanguage, selectedTranslitNusach)
    : null;

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View
        style={[
          styles.overlay,
          {
            paddingBottom: Math.max(insets.bottom + 14, 22),
            paddingTop: Math.max(insets.top + 16, 32),
          },
        ]}
      >
        <Pressable
          accessibilityLabel="Закрыть текст благословения"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFillObject}
        />

        {textResult && activeContent ? (
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

            <BlessingLanguageTabs
              onValueChange={onLanguageChange}
              value={selectedLanguage}
            />

            {selectedLanguage === 'translit' ? (
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
                activeContent.blocks.map((block) => (
                  <View
                    key={block.key}
                    style={[styles.textBlock, block.kind === 'insert' && styles.insertBlock]}
                  >
                    {block.titleRu ? (
                      <Text
                        style={[
                          styles.blockTitle,
                          block.kind === 'insert' && styles.insertBlockTitle,
                        ]}
                      >
                        {block.titleRu}
                      </Text>
                    ) : null}
                    <Text
                      selectable
                      style={[
                        styles.bodyText,
                        selectedLanguage === 'he' && styles.hebrewBodyText,
                      ]}
                    >
                      {block.body}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.placeholderText}>{activeContent.message}</Text>
              )}
            </ScrollView>
          </GlassCard>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
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
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(255,200,50,0.54)',
    backgroundColor: 'rgba(255,200,50,0.05)',
    paddingLeft: 10,
    paddingVertical: 8,
  },
  blockTitle: {
    color: colors.goldAccent,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  insertBlockTitle: {
    color: colors.goldAccent,
  },
  bodyText: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 25,
  },
  hebrewBodyText: {
    textAlign: 'right',
    writingDirection: 'rtl',
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
