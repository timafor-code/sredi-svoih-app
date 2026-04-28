import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/glass/GlassCard';
import { Avatar } from '@/components/ui/Avatar';
import { FormField } from '@/components/ui/FormField';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { SubHeader } from '@/components/ui/SubHeader';
import { colors } from '@/theme/colors';

const tribes = ['Коэн', 'Леви', 'Исраэль'] as const;
const maritalOptions = ['Холост', 'Женат', 'Замужем', 'Разведён/а', 'Вдов/а'] as const;
const privacyOptions = ['Только раввин', 'Все участники', 'Публично'] as const;

function SelectPill<T extends string>({
  onChange,
  options,
  value,
}: {
  onChange: (value: T) => void;
  options: readonly T[];
  value: T;
}) {
  return (
    <View style={styles.pillWrap}>
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable key={option} onPress={() => onChange(option)} style={[styles.selectPill, active && styles.selectPillActive]}>
            <Text style={[styles.selectPillText, active && styles.selectPillTextActive]}>{option}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function EditProfileScreen() {
  const [firstName, setFirstName] = useState('Давид');
  const [lastName, setLastName] = useState('Коэн');
  const [hebrewName, setHebrewName] = useState('דוד בן אברהם');
  const [dob, setDob] = useState('1988-05-14');
  const [tribe, setTribe] = useState<(typeof tribes)[number]>('Коэн');
  const [marital, setMarital] = useState<(typeof maritalOptions)[number]>('Женат');
  const [phone, setPhone] = useState('+7 (916) 234-56-78');
  const [email, setEmail] = useState('david.cohen@gmail.com');
  const [city, setCity] = useState('Москва');
  const [about, setAbout] = useState('');
  const [privacyBirthday, setPrivacyBirthday] = useState<(typeof privacyOptions)[number]>('Все участники');
  const [privacyPhone, setPrivacyPhone] = useState<(typeof privacyOptions)[number]>('Только раввин');
  const [privacyProfile, setPrivacyProfile] = useState<(typeof privacyOptions)[number]>('Все участники');

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen contentContainerStyle={{ gap: 20 }}>
        <SubHeader title="Редактировать профиль" />

        <View style={styles.avatarRow}>
          <View style={styles.avatarWrap}>
            <Avatar initials="ДК" size={80} />
            <View style={styles.cameraBadge}>
              <Text style={styles.cameraText}>📷</Text>
            </View>
          </View>
          <View style={styles.flex}>
            <Text style={styles.photoTitle}>Фото профиля</Text>
            <Text style={styles.photoText}>Видно участникам общины{'\n'}Рекомендуем 400×400 px</Text>
          </View>
        </View>

        <View style={styles.section}>
          <SectionTitle title="ИМЯ" />
          <View style={styles.twoCols}>
            <View style={styles.flex}>
              <FormField label="Имя" value={firstName} onChangeText={setFirstName} />
            </View>
            <View style={styles.flex}>
              <FormField label="Фамилия" value={lastName} onChangeText={setLastName} />
            </View>
          </View>
          <FormField label="ЕВРЕЙСКОЕ ИМЯ (שם עברי)" value={hebrewName} onChangeText={setHebrewName} />
          <GlassCard>
            <View style={styles.tipRow}>
              <Text style={styles.tipEmoji}>💡</Text>
              <Text style={styles.tipText}>Еврейское имя используется в молитвенных записках и уведомлениях общины</Text>
            </View>
          </GlassCard>
        </View>

        <View style={styles.section}>
          <SectionTitle title="ДАТА РОЖДЕНИЯ" />
          <FormField label="Гражданская дата" value={dob} onChangeText={setDob} />
          <View style={styles.hebrewDate}>
            <Text style={styles.tipEmoji}>✡️</Text>
            <View>
              <Text style={styles.goldOverline}>ЕВРЕЙСКАЯ ДАТА</Text>
              <Text style={styles.goldTitle}>26 Ияра 5748</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <SectionTitle title="ПРОИСХОЖДЕНИЕ" />
          <SelectPill options={tribes} value={tribe} onChange={setTribe} />
          <Text style={styles.helper}>Влияет на порядок алии к Торе и некоторые галахические аспекты</Text>
        </View>

        <View style={styles.section}>
          <SectionTitle title="СЕМЕЙНОЕ ПОЛОЖЕНИЕ" />
          <SelectPill options={maritalOptions} value={marital} onChange={setMarital} />
        </View>

        <View style={styles.section}>
          <SectionTitle title="КОНТАКТЫ" />
          <FormField label="Телефон" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <FormField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
          <FormField label="Город проживания" value={city} onChangeText={setCity} />
        </View>

        <View style={styles.section}>
          <SectionTitle title="О СЕБЕ" />
          <FormField label="Несколько слов о себе" value={about} onChangeText={setAbout} placeholder="Расскажите о себе, интересах, как связаны с общиной…" multiline />
          <Text style={styles.counter}>{about.length} / 200</Text>
        </View>

        <View style={styles.section}>
          <SectionTitle title="ПРИВАТНОСТЬ" />
          <GlassCard>
            <Text style={styles.privacyLabel}>Профиль виден</Text>
            <SelectPill options={privacyOptions} value={privacyProfile} onChange={setPrivacyProfile} />
            <Text style={styles.privacyLabel}>День рождения виден</Text>
            <SelectPill options={privacyOptions} value={privacyBirthday} onChange={setPrivacyBirthday} />
            <Text style={styles.privacyLabel}>Телефон виден</Text>
            <SelectPill options={privacyOptions} value={privacyPhone} onChange={setPrivacyPhone} />
          </GlassCard>
        </View>

        <PrimaryButton
          title="Сохранить изменения"
          buttonStyle={styles.saveButton}
          onPress={() => Alert.alert('Сохранено', 'Изменения сохранены локально (mock).')}
        />

        <Pressable style={styles.deleteButton}>
          <Text style={styles.deleteText}>Удалить аккаунт</Text>
        </Pressable>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarWrap: {
    position: 'relative',
  },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.orange,
    shadowColor: colors.orange,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  cameraText: {
    fontSize: 13,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  photoTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  photoText: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  section: {
    gap: 10,
  },
  twoCols: {
    flexDirection: 'row',
    gap: 10,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tipEmoji: {
    fontSize: 18,
  },
  tipText: {
    flex: 1,
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 18,
  },
  hebrewDate: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,200,50,0.15)',
    backgroundColor: 'rgba(255,200,50,0.07)',
    paddingHorizontal: 14,
  },
  goldOverline: {
    color: colors.accent.goldTextDim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  goldTitle: {
    color: colors.accent.goldText,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 2,
  },
  helper: {
    color: colors.textGhost,
    fontSize: 11,
    lineHeight: 17,
  },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  selectPill: {
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.glass.w10,
    backgroundColor: colors.glass.w07,
    paddingHorizontal: 14,
  },
  selectPillActive: {
    borderColor: 'rgba(240,122,42,0.40)',
    backgroundColor: colors.orange,
    shadowColor: colors.orange,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  selectPillText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  selectPillTextActive: {
    color: colors.text,
  },
  counter: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 11,
    textAlign: 'right',
  },
  privacyLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 8,
  },
  saveButton: {
    minHeight: 48,
    borderRadius: 14,
  },
  deleteButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
  },
  deleteText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
});
