import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';

type IoniconName = keyof typeof Ionicons.glyphMap;

type BlessingConditionBadgeTone = 'complex' | 'condition' | 'dispute';

type BlessingConditionBadgeProps = {
  iconName?: IoniconName;
  label: string;
  tone?: BlessingConditionBadgeTone;
};

function getIconName(tone: BlessingConditionBadgeTone): IoniconName {
  switch (tone) {
    case 'complex':
      return 'layers-outline';
    case 'dispute':
      return 'help-circle-outline';
    case 'condition':
      return 'information-circle-outline';
  }
}

function getIconColor(tone: BlessingConditionBadgeTone): string {
  return tone === 'dispute' ? colors.orange : colors.goldAccent;
}

export function BlessingConditionBadge({
  iconName,
  label,
  tone = 'condition',
}: BlessingConditionBadgeProps) {
  return (
    <View
      style={[
        styles.badge,
        tone === 'complex' && styles.complexBadge,
        tone === 'dispute' && styles.disputeBadge,
      ]}
    >
      <Ionicons name={iconName ?? getIconName(tone)} size={13} color={getIconColor(tone)} />
      <Text
        numberOfLines={1}
        style={[
          styles.text,
          tone === 'complex' && styles.complexText,
          tone === 'dispute' && styles.disputeText,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.28)',
    backgroundColor: colors.accent.goldBg,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  complexBadge: {
    borderColor: 'rgba(255,200,50,0.36)',
    backgroundColor: colors.accent.goldBgStrong,
  },
  disputeBadge: {
    borderColor: 'rgba(240,122,42,0.34)',
    backgroundColor: colors.accent.orangeBg,
  },
  text: {
    flexShrink: 1,
    color: colors.goldAccent,
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 13,
  },
  complexText: {
    color: colors.accent.goldText,
  },
  disputeText: {
    color: colors.orange,
  },
});
