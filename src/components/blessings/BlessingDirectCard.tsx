import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BlessingLanguageTabs } from '@/components/blessings/BlessingLanguageTabs';
import { GlassCard } from '@/components/glass/GlassCard';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import type {
  Blessing,
  BlessingContentBlock,
  BlessingLanguage,
  BlessingTextResult,
} from '@/types/blessing';

type IoniconName = keyof typeof Ionicons.glyphMap;

type BlessingDirectCardProps = {
  onLanguageChange: (language: BlessingLanguage) => void;
  onOpenText: () => void;
  selectedLanguage: BlessingLanguage;
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
  he: 'Текст на иврите будет добавлен после проверки',
  translit: 'Транслитерация будет добавлена после проверки',
  ru: 'Текст требует проверки и будет добавлен позже',
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

function getActiveTextContent(textResult: BlessingTextResult): ActiveTextContent {
  const { contentBlocks, language } = textResult;
  const visibleBlocks =
    language === 'ru'
      ? contentBlocks.filter((block) => !block.language || block.language === 'ru')
      : contentBlocks.filter((block) => block.language === language);

  const blocks = visibleBlocks.filter(hasBlockBody).map(toDisplayBlock);

  if (blocks.length > 0) {
    return {
      blocks,
      kind: 'blocks',
    };
  }

  return {
    kind: 'placeholder',
    message: languagePlaceholders[language],
  };
}

export function BlessingDirectCard({
  onLanguageChange,
  onOpenText,
  selectedLanguage,
  textResult,
}: BlessingDirectCardProps) {
  const { blessing } = textResult;
  const activeContent = getActiveTextContent(textResult);
  const showVerificationNotice = blessing.needsVerification || textResult.needsVerification;

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

      {showVerificationNotice ? (
        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={18} color={colors.goldAccent} />
          <Text style={styles.noticeText}>Текст требует проверки</Text>
        </View>
      ) : null}

      <BlessingLanguageTabs value={selectedLanguage} onValueChange={onLanguageChange} />

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
  notice: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.18)',
    backgroundColor: 'rgba(255,200,50,0.07)',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  noticeText: {
    flex: 1,
    minWidth: 0,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
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
