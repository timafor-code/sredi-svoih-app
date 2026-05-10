import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BlessingLanguageTabs } from '@/components/blessings/BlessingLanguageTabs';
import { BlessingTranslitNusachTabs } from '@/components/blessings/BlessingTranslitNusachTabs';
import { GlassCard } from '@/components/glass/GlassCard';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import type {
  Blessing,
  BlessingContentBlock,
  BlessingLanguage,
  BlessingTextResult,
  BlessingTranslitNusach,
} from '@/types/blessing';

type IoniconName = keyof typeof Ionicons.glyphMap;

type BlessingDirectCardProps = {
  onLanguageChange: (language: BlessingLanguage) => void;
  onOpenText: () => void;
  onTranslitNusachChange: (value: BlessingTranslitNusach) => void;
  selectedLanguage: BlessingLanguage;
  selectedTranslitNusach: BlessingTranslitNusach;
  textResult: BlessingTextResult;
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
  he: 'Текст на иврите пока недоступен',
  translit: 'Транслитерация пока недоступна',
  ru: 'Русский перевод пока недоступен',
};

const translitNusachPlaceholders: Record<BlessingTranslitNusach, string> = {
  sephard: 'Сефардская транслитерация пока недоступна',
  ashkenaz: 'Ашкеназская транслитерация пока недоступна',
};

function getBlessingIcon(blessing: Blessing): IoniconName {
  switch (blessing.slug) {
    case 'lightning':
      return 'flash-outline';
    case 'thunder':
      return 'cloud-outline';
    case 'rainbow':
      return 'color-palette-outline';
    case 'asher_yatzar':
      return 'leaf-outline';
    case 'shehecheyanu':
      return 'sparkles-outline';
    default:
      return 'book-outline';
  }
}

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
  const previewBlocks = contentBlocks.filter(
    (block) =>
      block.renderVariant !== 'manual_collapsible' &&
      !block.collapsibleGroupKey &&
      !block.prefaceMode,
  );

  switch (selectedLanguage) {
    case 'he':
      return previewBlocks.filter((block) => block.language === 'he');
    case 'ru':
      return previewBlocks.filter((block) => !block.language || block.language === 'ru');
    case 'translit':
      return getVisibleTranslitBlocks(previewBlocks, selectedTranslitNusach);
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

export function BlessingDirectCard({
  onLanguageChange,
  onOpenText,
  onTranslitNusachChange,
  selectedLanguage,
  selectedTranslitNusach,
  textResult,
}: BlessingDirectCardProps) {
  const { blessing } = textResult;
  const activeContent = getActiveTextContent(
    textResult,
    selectedLanguage,
    selectedTranslitNusach,
  );

  return (
    <GlassCard contentStyle={styles.content} style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconBox}>
          <LinearGradient
            colors={['rgba(255,200,50,0.18)', 'rgba(240,122,42,0.08)']}
            style={StyleSheet.absoluteFillObject}
          />
          <Ionicons name={getBlessingIcon(blessing)} size={24} color={colors.goldAccent} />
        </View>

        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>Благословение</Text>
          <Text numberOfLines={2} style={styles.title}>
            {blessing.titleRu}
          </Text>
          {blessing.descriptionRu ? (
            <Text style={styles.description}>
              {blessing.descriptionRu}
            </Text>
          ) : null}
        </View>
      </View>

      <BlessingLanguageTabs value={selectedLanguage} onValueChange={onLanguageChange} />

      {selectedLanguage === 'translit' ? (
        <BlessingTranslitNusachTabs
          value={selectedTranslitNusach}
          onValueChange={onTranslitNusachChange}
        />
      ) : null}

      <View style={styles.textBox}>
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
              <Text style={styles.bodyText}>
                {block.body}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.placeholderText}>
            {activeContent.message}
          </Text>
        )}
      </View>

      <Pressable
        accessibilityLabel="Открыть полный текст"
        accessibilityRole="button"
        onPress={onOpenText}
        style={({ pressed }) => [styles.openButton, pressed && styles.pressed]}
      >
        <Ionicons name="document-text-outline" size={16} color={colors.goldAccent} />
        <Text numberOfLines={1} style={styles.openButtonText}>
          Открыть полный текст
        </Text>
      </Pressable>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    borderColor: 'rgba(255,200,50,0.18)',
  },
  content: {
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconBox: {
    width: 50,
    height: 50,
    overflow: 'hidden',
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.24)',
    backgroundColor: colors.accent.goldBg,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 5,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 27,
  },
  description: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 7,
  },
  textBox: {
    gap: 12,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.glass.w04,
    padding: 14,
  },
  textBlock: {
    gap: 6,
  },
  insertBlock: {
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(255,200,50,0.54)',
    backgroundColor: 'rgba(255,200,50,0.05)',
    paddingLeft: 9,
    paddingVertical: 7,
  },
  blockTitle: {
    color: colors.goldAccent,
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
  },
  insertBlockTitle: {
    color: colors.goldAccent,
  },
  bodyText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 21,
  },
  placeholderText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 21,
  },
  openButton: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.26)',
    backgroundColor: colors.accent.goldBg,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  openButtonText: {
    flexShrink: 1,
    color: colors.goldAccent,
    fontSize: 11,
    fontWeight: '900',
  },
  pressed: {
    opacity: 0.78,
  },
});
