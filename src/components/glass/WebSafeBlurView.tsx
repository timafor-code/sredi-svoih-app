import { type ComponentProps } from 'react';
import { BlurView } from 'expo-blur';
import { Platform, View } from 'react-native';

type WebSafeBlurViewProps = ComponentProps<typeof BlurView>;

export function WebSafeBlurView(props: WebSafeBlurViewProps) {
  if (Platform.OS === 'web') {
    return <View pointerEvents="none" style={props.style} />;
  }

  return <BlurView {...props} />;
}
