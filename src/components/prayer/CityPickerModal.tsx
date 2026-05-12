import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/glass/GlassCard';
import {
  isSupportedZmanimCity,
  normalizeZmanimCityName,
  SUPPORTED_ZMANIM_CITIES,
} from '@/lib/zmanim';
import { LocationServiceError, requestCurrentCityByGps } from '@/services/locationService';
import { useSettingsStore } from '@/store/useSettingsStore';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';

type CityPickerModalProps = {
  onClose: () => void;
  visible: boolean;
};

type GpsState = 'idle' | 'loading' | 'message';

export function CityPickerModal({ onClose, visible }: CityPickerModalProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const city = useSettingsStore((state) => state.city);
  const gpsCity = useSettingsStore((state) => state.gpsCity);
  const locationPermissionStatus = useSettingsStore((state) => state.locationPermissionStatus);
  const resetToGpsCity = useSettingsStore((state) => state.resetToGpsCity);
  const setCity = useSettingsStore((state) => state.setCity);
  const setGpsCity = useSettingsStore((state) => state.setGpsCity);
  const setLocationPermissionStatus = useSettingsStore((state) => state.setLocationPermissionStatus);
  const zmanimSource = useSettingsStore((state) => state.zmanimSource);
  const [selectedCity, setSelectedCity] = useState(city);
  const [gpsState, setGpsState] = useState<GpsState>('idle');
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);

  const panelMaxHeight = Math.max(
    360,
    Math.min(height - insets.top - insets.bottom - 36, 720),
  );
  const scrollMaxHeight = Math.max(300, panelMaxHeight);
  const normalizedGpsCity = useMemo(
    () => (gpsCity ? normalizeZmanimCityName(gpsCity) : null),
    [gpsCity],
  );
  const canUseCachedGpsCity = Boolean(normalizedGpsCity && isSupportedZmanimCity(normalizedGpsCity));
  const gpsButtonTitle = canUseCachedGpsCity && zmanimSource === 'manual'
    ? 'Использовать GPS'
    : 'Определить по GPS';

  useEffect(() => {
    if (!visible) return;

    setSelectedCity(city);
    setGpsState('idle');

    if (gpsCity && !isSupportedZmanimCity(gpsCity)) {
      setGpsMessage(`Город определён: ${gpsCity}. Пока он не поддерживается для зманим.`);
      return;
    }

    setGpsMessage(null);
  }, [city, gpsCity, visible]);

  const handleSave = () => {
    setCity(selectedCity);
    onClose();
  };

  const handleGpsPress = async () => {
    if (canUseCachedGpsCity && normalizedGpsCity && zmanimSource === 'manual') {
      resetToGpsCity();
      onClose();
      return;
    }

    setGpsState('loading');
    setGpsMessage(null);

    try {
      const result = await requestCurrentCityByGps();

      if (!result) {
        setGpsState('message');
        setGpsMessage('Не удалось определить город по геопозиции. Выберите город вручную.');
        return;
      }

      setLocationPermissionStatus('granted');

      if (!isSupportedZmanimCity(result.city)) {
        setGpsCity(result.city);
        setGpsState('message');
        setGpsMessage(`Город определён: ${result.city}. Пока он не поддерживается для зманим. Выберите город из списка.`);
        return;
      }

      const normalizedCity = normalizeZmanimCityName(result.city);
      setGpsCity(normalizedCity);
      resetToGpsCity();
      setSelectedCity(normalizedCity);
      setGpsState('idle');
      onClose();
    } catch (error) {
      setGpsState('message');

      if (error instanceof LocationServiceError && error.code === 'permission-denied') {
        setLocationPermissionStatus('denied');
        setGpsMessage('Нет доступа к геопозиции. Выберите город вручную.');
        return;
      }

      setGpsMessage('Не удалось определить город по геопозиции. Выберите город вручную.');
    }
  };

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
          accessibilityLabel="Закрыть выбор города"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFillObject}
        />

        <View style={[styles.panel, { maxHeight: panelMaxHeight }]}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator
            style={[styles.scrollArea, { maxHeight: scrollMaxHeight }]}
          >
            <GlassCard contentStyle={styles.cardContent} style={styles.card}>
              <View style={styles.header}>
                <View style={styles.headerText}>
                  <Text style={styles.eyebrow}>Город</Text>
                  <Text numberOfLines={2} style={styles.title}>
                    Зманим по месту
                  </Text>
                </View>

                <Pressable
                  accessibilityLabel="Закрыть"
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={onClose}
                  style={({ pressed }) => [
                    styles.closeButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons name="close" size={20} color={colors.text} />
                </Pressable>
              </View>

              <View style={styles.metaRow}>
                <View style={styles.metaPill}>
                  <Ionicons name="location" size={12} color={colors.textMuted} />
                  <Text numberOfLines={1} style={styles.metaText}>
                    {city}
                  </Text>
                </View>
                <View style={styles.metaPill}>
                  <Ionicons
                    name={zmanimSource === 'gps' ? 'navigate' : 'create-outline'}
                    size={12}
                    color={colors.textMuted}
                  />
                  <Text numberOfLines={1} style={styles.metaText}>
                    {zmanimSource === 'gps' ? 'GPS' : 'ручной выбор'}
                  </Text>
                </View>
              </View>

              <Pressable
                accessibilityRole="button"
                disabled={gpsState === 'loading'}
                onPress={handleGpsPress}
                style={({ pressed }) => [
                  styles.gpsBox,
                  pressed && styles.pressed,
                  gpsState === 'loading' && styles.disabled,
                ]}
              >
                <View style={styles.gpsIcon}>
                  {gpsState === 'loading' ? (
                    <ActivityIndicator color={colors.goldAccent} size="small" />
                  ) : (
                    <Ionicons name="navigate" size={18} color={colors.goldAccent} />
                  )}
                </View>
                <View style={styles.gpsText}>
                  <Text style={styles.gpsTitle}>
                    {gpsState === 'loading' ? 'Определяем город' : gpsButtonTitle}
                  </Text>
                  <Text numberOfLines={2} style={styles.gpsSubtitle}>
                    {normalizedGpsCity && canUseCachedGpsCity
                      ? `GPS: ${normalizedGpsCity}`
                      : locationPermissionStatus === 'denied'
                        ? 'Геопозиция недоступна'
                        : 'По текущей геопозиции'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
              </Pressable>

              {gpsMessage ? (
                <View style={styles.messageBox}>
                  <Ionicons
                    name={locationPermissionStatus === 'denied' ? 'lock-closed-outline' : 'alert-circle-outline'}
                    size={16}
                    color={colors.warning}
                  />
                  <Text style={styles.messageText}>{gpsMessage}</Text>
                </View>
              ) : null}

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Поддерживаемые города</Text>
                <Text style={styles.sectionCount}>{SUPPORTED_ZMANIM_CITIES.length}</Text>
              </View>

              <View style={styles.listBox}>
                {SUPPORTED_ZMANIM_CITIES.map((item, index) => {
                  const isLast = index === SUPPORTED_ZMANIM_CITIES.length - 1;
                  const isSelected = selectedCity === item;
                  const isCurrent = city === item;

                  return (
                    <Pressable
                      accessibilityRole="button"
                      key={item}
                      onPress={() => setSelectedCity(item)}
                      style={({ pressed }) => [
                        styles.row,
                        !isLast && styles.rowDivider,
                        isSelected && styles.rowSelected,
                        pressed && styles.rowPressed,
                      ]}
                    >
                      <View style={styles.rowIcon}>
                        <Ionicons
                          name={isSelected ? 'location' : 'location-outline'}
                          size={17}
                          color={isSelected ? colors.goldAccent : colors.textDim}
                        />
                      </View>
                      <View style={styles.rowText}>
                        <Text style={[styles.rowName, isSelected && styles.rowNameSelected]}>
                          {item}
                        </Text>
                        {isCurrent ? (
                          <Text style={styles.rowBadge}>
                            {zmanimSource === 'gps' ? 'сейчас по GPS' : 'сейчас вручную'}
                          </Text>
                        ) : null}
                      </View>
                      {isSelected ? (
                        <Ionicons name="checkmark" size={20} color={colors.goldAccent} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                accessibilityRole="button"
                onPress={handleSave}
                style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}
              >
                <Text style={styles.saveButtonText}>Сохранить</Text>
              </Pressable>
            </GlassCard>
          </ScrollView>
        </View>
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
  scrollArea: {
    borderRadius: radius.glassCard,
  },
  scrollContent: {
    paddingBottom: 2,
  },
  card: {
    borderColor: 'rgba(255,200,50,0.18)',
  },
  cardContent: {
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
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
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.glass.w08,
  },
  pressed: {
    opacity: 0.78,
  },
  disabled: {
    opacity: 0.72,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaPill: {
    maxWidth: '100%',
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w06,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  metaText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  gpsBox: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.accent.goldBorder,
    backgroundColor: colors.accent.goldBg,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  gpsIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accent.goldBorder,
    backgroundColor: 'rgba(255,200,50,0.08)',
  },
  gpsText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  gpsTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  gpsSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  messageBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,159,10,0.24)',
    backgroundColor: 'rgba(255,159,10,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  messageText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '900',
  },
  sectionCount: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '800',
  },
  listBox: {
    overflow: 'hidden',
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.glass.w04,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  rowSelected: {
    backgroundColor: 'rgba(255,200,50,0.07)',
    borderLeftWidth: 2,
    borderLeftColor: colors.goldAccent,
  },
  rowIcon: {
    width: 24,
    alignItems: 'center',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 18,
  },
  rowNameSelected: {
    fontWeight: '900',
  },
  rowBadge: {
    color: colors.goldAccent,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  saveButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.goldAccent,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  saveButtonText: {
    color: '#1A1100',
    fontSize: 14,
    fontWeight: '900',
  },
});
