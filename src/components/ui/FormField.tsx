import { Text, TextInput, View } from 'react-native';

type FormFieldProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
};

export function FormField({ label, value, onChangeText, placeholder, multiline, keyboardType = 'default' }: FormFieldProps) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '600' }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.3)"
        multiline={multiline}
        keyboardType={keyboardType}
        style={{
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.1)',
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingVertical: multiline ? 10 : 12,
          minHeight: multiline ? 90 : undefined,
          textAlignVertical: multiline ? 'top' : 'center',
          color: '#fff',
          backgroundColor: 'rgba(255,255,255,0.05)',
        }}
      />
    </View>
  );
}
