import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { IOSGroup } from '@/components/ui/IOSGroup';
import { ListRow } from '@/components/ui/ListRow';
import { Screen } from '@/components/ui/Screen';
import { colors } from '@/theme/colors';

const cities = ['Москва', 'Санкт-Петербург', 'Иерусалим', 'Тель-Авив', 'Нью-Йорк'];

export default function CityPicker() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ headerShown: false, presentation: 'modal' }} />
      <Screen contentContainerStyle={{ gap: 16 }}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Город для зманим</Text>
            <Text style={styles.subtitle}>Расчёт идёт по выбранному городу, не по GPS</Text>
          </View>
          <Pressable onPress={() => router.back()} style={styles.close}>
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>
        </View>

        <IOSGroup>
          {cities.map((city, index) => (
            <ListRow
              key={city}
              icon="📍"
              title={city}
              rightText={city === 'Москва' ? '✓' : undefined}
              onPress={() => router.back()}
              isLast={index === cities.length - 1}
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
