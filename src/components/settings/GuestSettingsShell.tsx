import { Link } from 'expo-router';
import type { Href } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Logo } from '@/components/ui/BrandHeader';
import { IOSGroup } from '@/components/ui/IOSGroup';
import { ListRow } from '@/components/ui/ListRow';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { useSettingsStore } from '@/store/useSettingsStore';
import { colors } from '@/theme/colors';

const cityPickerHref = '/modals/city-picker' as Href;
const prayerTrackerHref = '/profile/prayer-tracker' as Href;
const aboutHref = '/profile/about' as Href;
const supportHref = '/profile/support' as Href;

export function GuestSettingsShell() {
  const city = useSettingsStore((state) => state.city);
  const customGpsLocation = useSettingsStore((state) => state.customGpsLocation);
  const zmanimSource = useSettingsStore((state) => state.zmanimSource);
  const effectiveCity = zmanimSource === 'gps' && customGpsLocation
    ? customGpsLocation.city
    : city;

  return (
    <Screen contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Logo />
      </View>

      <View style={styles.titleBlock}>
        <Text style={styles.title}>Настройки</Text>
        <Text style={styles.subtitle}>
          Настройки приложения и личной практики на этом устройстве.
        </Text>
      </View>

      <View style={styles.section}>
        <SectionTitle title="На устройстве" />
        <IOSGroup>
          <Link href={cityPickerHref} asChild>
            <ListRow
              icon="📍"
              title="Город"
              subtitle="Для расчёта времени молитв"
              rightText={effectiveCity}
              onPress={() => undefined}
              isLast
            />
          </Link>
        </IOSGroup>
      </View>

      <View style={styles.section}>
        <SectionTitle title="Практика" />
        <IOSGroup>
          <Link href={prayerTrackerHref} asChild>
            <ListRow
              icon="🙏"
              title="Молитвенный трекер"
              subtitle="История молитв, Шма и Омера на этом устройстве"
              onPress={() => undefined}
              isLast
            />
          </Link>
        </IOSGroup>
      </View>

      <View style={styles.section}>
        <SectionTitle title="О приложении" />
        <IOSGroup>
          <Link href={aboutHref} asChild>
            <ListRow
              icon="ℹ️"
              title="О приложении"
              subtitle="Версия, информация и политика конфиденциальности"
              onPress={() => undefined}
            />
          </Link>
          <Link href={supportHref} asChild>
            <ListRow
              icon="❤️"
              title="Поддержать общину"
              subtitle="Информация о поддержке общины"
              onPress={() => undefined}
              isLast
            />
          </Link>
        </IOSGroup>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 18,
  },
  header: {
    alignItems: 'flex-start',
  },
  titleBlock: {
    gap: 4,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
  section: {
    gap: 8,
  },
});
