import type { ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BlessingItemSchemeCard } from '@/components/blessings/BlessingItemSchemeCard';
import { radius } from '@/theme/radius';
import type { BlessingItemDetails, BlessingResolvedStep } from '@/types/blessing';

type BlessingItemSchemeModalProps = {
  details: BlessingItemDetails | null;
  onClose: () => void;
  onStepPress: (step: BlessingResolvedStep) => void;
  overlayContent?: ReactNode;
  visible: boolean;
};

export function BlessingItemSchemeModal({
  details,
  onClose,
  onStepPress,
  overlayContent,
  visible,
}: BlessingItemSchemeModalProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const panelMaxHeight = Math.max(
    320,
    Math.min(height - insets.top - insets.bottom - 36, 720),
  );
  const scrollMaxHeight = Math.max(260, panelMaxHeight);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View
        style={[
          styles.overlay,
          {
            paddingBottom: Math.max(insets.bottom + 14, 22),
            paddingTop: Math.max(insets.top + 12, 20),
          },
        ]}
      >
        <Pressable
          accessibilityLabel="Закрыть схему"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFillObject}
        />

        <View style={[styles.panel, { maxHeight: panelMaxHeight }]}>
          {details ? (
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator
              style={[styles.scrollArea, { maxHeight: scrollMaxHeight }]}
            >
              <BlessingItemSchemeCard
                details={details}
                onClose={onClose}
                onStepPress={onStepPress}
              />
            </ScrollView>
          ) : null}
        </View>
        {overlayContent ? <View style={styles.overlayLayer}>{overlayContent}</View> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: 14,
    backgroundColor: 'rgba(0,0,0,0.68)',
  },
  panel: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  overlayLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    elevation: 10,
  },
  scrollArea: {
    borderRadius: radius.glassCard,
  },
  scrollContent: {
    paddingBottom: 2,
  },
});
