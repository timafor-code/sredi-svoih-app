import { type ComponentProps } from 'react';
import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, View } from 'react-native';

type WebSafeBlurViewProps = ComponentProps<typeof BlurView>;

export function WebSafeBlurView(props: WebSafeBlurViewProps) {
  if (Platform.OS === 'web') {
    return (
      <View
        pointerEvents="none"
        style={[
          props.style,
          props.tint === 'light' ? styles.webLightFallback : styles.webDarkFallback,
        ]}
      />
    );
  }

  return <BlurView {...props} />;
}

const styles = StyleSheet.create({
  webDarkFallback: {
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  webLightFallback: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
});
