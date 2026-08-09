import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { IOSGroup } from '@/components/ui/IOSGroup';
import { ListRow } from '@/components/ui/ListRow';
import { Screen } from '@/components/ui/Screen';
import { SUPPORTED_ZMANIM_CITIES, type SupportedZmanimCity } from '@/lib/zmanim';
import { useSettingsStore } from '@/store/useSettingsStore';
import { colors } from '@/theme/colors';

export default function CityPicker() {
  const router = useRouter();
  const city = useSettingsStore((state) => state.city);
  const setCity = useSettingsStore((state) => state.setCity);

  const handleCityPress = (nextCity: SupportedZmanimCity) => {
    setCity(nextCity);
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false, presentation: 'modal' }} />
      <Screen contentContainerStyle={{ gap: 16 }}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Город для зманим</Text>
            <Text style={styles.subtitle}>Расчёт идёт по выбранному городу, не по GPS</Text>
          </View>
          <Pressable
            accessibilityLabel="Закрыть выбор города"
            accessibilityRole="button"
            onPress={() => router.back()}
            style={styles.close}
          >
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>
        </View>

        <IOSGroup>
          {SUPPORTED_ZMANIM_CITIES.map((item, index) => (
            <ListRow
              key={item}
              icon="📍"
              title={item}
              rightText={item === city ? '✓' : undefined}
              onPress={() => handleCityPress(item)}
              isLast={index === SUPPORTED_ZMANIM_CITIES.length - 1}
            />
          ))}
        </IOSGroup>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 13,
    marginTop: 4,
  },
  close: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.w10,
  },
});
