import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';

type SegmentControlProps<T extends string> = {
  items: readonly T[];
  value: T;
  onChange: (value: T) => void;
};

export function SegmentControl<T extends string>({ items, value, onChange }: SegmentControlProps<T>) {
  return (
    <View style={styles.container}>
      {items.map((item) => {
        const active = value === item;
        return (
          <Pressable
            key={item}
            onPress={() => onChange(item)}
            style={[styles.item, active && styles.itemActive]}
          >
            <Text numberOfLines={1} style={[styles.label, active && styles.labelActive]}>
              {item}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 2,
    padding: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glass.w08,
    backgroundColor: colors.glass.w07,
  },
  item: {
    flex: 1,
    minHeight: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  itemActive: {
    backgroundColor: colors.glass.w12,
  },
  label: {
    color: colors.textFaint,
    fontSize: 14,
    fontWeight: '500',
    includeFontPadding: false,
  },
  labelActive: {
    color: colors.text,
    fontWeight: '600',
  },
});
