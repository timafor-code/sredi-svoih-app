import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import type { BlessingCondition, BlessingDispute, DisputeSeverity } from '@/types/blessing';

type BlessingConditionBadgeProps =
  | {
      condition: BlessingCondition;
      dispute?: never;
      kind: 'condition';
    }
  | {
      condition?: never;
      dispute: BlessingDispute;
      kind: 'dispute';
    };

const severityLabels: Record<DisputeSeverity, string> = {
  info: 'Инфо',
  ask_rav: 'Уточнить',
  machloket: 'Махлокет',
};

export function BlessingConditionBadge(props: BlessingConditionBadgeProps) {
  const isDispute = props.kind === 'dispute';
  const title = isDispute ? props.dispute.titleRu : props.condition.titleRu;
  const description = isDispute ? props.dispute.descriptionRu : props.condition.descriptionRu;
  const severity = isDispute ? props.dispute.severity : null;

  return (
    <View style={styles.badge}>
      <View style={styles.iconBox}>
        <Ionicons
          name={isDispute ? 'alert-circle-outline' : 'information-circle-outline'}
          size={18}
          color={colors.goldAccent}
        />
      </View>
      <View style={styles.textBlock}>
        <View style={styles.titleRow}>
          <Text numberOfLines={2} style={styles.title}>
            {title}
          </Text>
          {severity ? (
            <View style={styles.severityPill}>
              <Text numberOfLines={1} style={styles.severityText}>
                {severityLabels[severity]}
              </Text>
            </View>
          ) : null}
        </View>
        {description ? (
          <Text style={styles.description}>
            {description}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,159,10,0.28)',
    backgroundColor: 'rgba(255,159,10,0.075)',
    padding: 12,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.24)',
    backgroundColor: colors.accent.goldBg,
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 17,
  },
  severityPill: {
    maxWidth: 92,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(240,122,42,0.34)',
    backgroundColor: colors.accent.orangeBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  severityText: {
    color: colors.orange,
    fontSize: 10,
    fontWeight: '800',
  },
  description: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
});
