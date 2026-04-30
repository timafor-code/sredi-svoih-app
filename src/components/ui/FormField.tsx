import { StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '@/theme/colors';

type FormFieldProps = {
  editable?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  label: string;
  multiline?: boolean;
  onChangeText: (text: string) => void;
  placeholder?: string;
  value: string;
};

export function FormField({
  editable = true,
  keyboardType = 'default',
  label,
  multiline,
  onChangeText,
  placeholder,
  value,
}: FormFieldProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        editable={editable}
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.3)"
        selectionColor={colors.orange}
        style={[styles.input, multiline && styles.multiline, !editable && styles.disabledInput]}
        textAlignVertical={multiline ? 'top' : 'center'}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  label: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  input: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w06,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  multiline: {
    minHeight: 90,
    lineHeight: 22,
  },
  disabledInput: {
    opacity: 0.6,
  },
});
