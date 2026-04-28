import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { IOSGroup } from '@/components/ui/IOSGroup';
import { ListRow } from '@/components/ui/ListRow';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { SubHeader } from '@/components/ui/SubHeader';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { colors } from '@/theme/colors';

const nusachOptions = ['Ашкеназ', 'Сефард', 'Хасид (Ари)', 'Йемени'] as const;

export default function SiddurScreen() {
  const [nusach, setNusach] = useState<(typeof nusachOptions)[number]>('Ашкеназ');
  const [lang, setLang] = useState('Иврит + русский');
  const [fontSize, setFontSize] = useState(16);
  const [nikud, setNikud] = useState(true);
  const [translit, setTranslit] = useState(false);
  const [darkMode, setDarkMode] = useState(true);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen contentContainerStyle={{ gap: 16 }}>
        <SubHeader title="Сидур" subtitle="Нусах, язык, шрифт и другие настройки" />

        <SectionTitle title="НУСАХ" />
        <IOSGroup>
          {nusachOptions.map((item, index) => (
            <ListRow key={item} title={item} rightText={nusach === item ? '✓' : undefined} onPress={() => setNusach(item)} isLast={index === nusachOptions.length - 1} />
          ))}
        </IOSGroup>

        <SectionTitle title="ОТОБРАЖЕНИЕ" />
        <IOSGroup>
          <ListRow icon="🌐" title="Язык перевода" rightText={lang} onPress={() => setLang(lang === 'Иврит + русский' ? 'Русский' : 'Иврит + русский')} />
          <ToggleRow icon="🔤" label="Транслитерация" value={translit} onValueChange={setTranslit} />
          <ToggleRow icon="◌" label="Огласовки (никуд)" value={nikud} onValueChange={setNikud} />
          <ToggleRow icon="🌙" label="Тёмный режим" value={darkMode} onValueChange={setDarkMode} isLast />
        </IOSGroup>

        <SectionTitle title="РАЗМЕР ШРИФТА" />
        <GlassCard>
          <View style={styles.fontPreview}>
            <Text style={styles.smallA}>A</Text>
            <Text style={[styles.hebrewPreview, { fontSize }]}>בָּרוּךְ</Text>
            <Text style={styles.largeA}>A</Text>
          </View>
          <View style={styles.stepper}>
            {[12, 16, 20, 24].map((size) => (
              <Pressable key={size} onPress={() => setFontSize(size)} style={[styles.step, fontSize === size && styles.stepActive]}>
                <Text style={[styles.stepText, fontSize === size && styles.stepTextActive]}>{size}</Text>
              </Pressable>
            ))}
          </View>
        </GlassCard>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  fontPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  smallA: {
    color: colors.textFaint,
    fontSize: 13,
  },
  largeA: {
    color: colors.textFaint,
    fontSize: 20,
  },
  hebrewPreview: {
    color: colors.text,
    fontWeight: '600',
  },
  stepper: {
    flexDirection: 'row',
    gap: 8,
  },
  step: {
    flex: 1,
    minHeight: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w06,
  },
  stepActive: {
    borderColor: colors.accent.orangeBorder,
    backgroundColor: colors.accent.orangeBg,
  },
  stepText: {
    color: colors.textFaint,
    fontSize: 13,
    fontWeight: '600',
  },
  stepTextActive: {
    color: colors.orange,
  },
});
