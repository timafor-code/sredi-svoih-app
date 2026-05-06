import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';

type BlessingSearchBarProps = {
  onChangeText: (value: string) => void;
  value: string;
};

export function BlessingSearchBar({ onChangeText, value }: BlessingSearchBarProps) {
  return (
    <View style={styles.shell}>
      <BlurView tint="dark" intensity={30} style={StyleSheet.absoluteFillObject} />
      <LinearGradient
        colors={['rgba(255,255,255,0.095)', 'rgba(255,255,255,0.035)']}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFillObject}
      />
      <Ionicons name="search" size={20} color="rgba(255,255,255,0.42)" />
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChangeText}
        placeholder="Поиск благословения"
        placeholderTextColor="rgba(255,255,255,0.36)"
        returnKeyType="search"
        selectionColor={colors.orange}
        style={styles.input}
        value={value}
      />
      {value ? (
        <Pressable
          accessibilityLabel="Очистить поиск"
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => onChangeText('')}
          style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
        >
          <Ionicons name="close" size={16} color="rgba(255,255,255,0.58)" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    overflow: 'hidden',
    borderRadius: radius.glassCard,
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.16)',
    backgroundColor: colors.glass.w07,
    paddingHorizontal: 16,
    shadowColor: colors.orange,
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 16,
    paddingVertical: 0,
  },
  clearButton: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w07,
  },
  pressed: {
    opacity: 0.72,
  },
});
