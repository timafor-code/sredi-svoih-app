import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { GlassCard } from '@/components/glass/GlassCard';
import { Avatar } from '@/components/ui/Avatar';
import { FormField } from '@/components/ui/FormField';
import { IOSGroup } from '@/components/ui/IOSGroup';
import { ListRow } from '@/components/ui/ListRow';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SectionTitle } from '@/components/ui/SectionTitle';

const tribes = ['Коэн', 'Леви', 'Исраэль'] as const;
const maritalOptions = ['Холост', 'Женат', 'Замужем'] as const;
const privacyOptions = ['Только раввин', 'Все участники', 'Публично'] as const;

export default function EditProfileScreen() {
  const [firstName, setFirstName] = useState('Давид');
  const [lastName, setLastName] = useState('Коэн');
  const [hebrewName, setHebrewName] = useState('דוד בן אברהם');
  const [dob, setDob] = useState('1988-05-14');
  const [hebrewDob, setHebrewDob] = useState('26 Ияра 5748');
  const [tribe, setTribe] = useState<(typeof tribes)[number]>('Коэн');
  const [marital, setMarital] = useState<(typeof maritalOptions)[number]>('Женат');
  const [phone, setPhone] = useState('+7 (916) 234-56-78');
  const [email, setEmail] = useState('david.cohen@gmail.com');
  const [city, setCity] = useState('Москва');
  const [about, setAbout] = useState('Участник общины, интересуюсь недельной главой и ивритом.');
  const [privacyBirthday, setPrivacyBirthday] = useState<(typeof privacyOptions)[number]>('Все участники');
  const [privacyPhone, setPrivacyPhone] = useState<(typeof privacyOptions)[number]>('Только раввин');
  const [privacyProfile, setPrivacyProfile] = useState<(typeof privacyOptions)[number]>('Все участники');

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Редактировать профиль', headerStyle: { backgroundColor: '#0D0D1A' }, headerTintColor: '#fff' }} />
      <Screen>
        <GlassCard>
          <View style={{ alignItems: 'center', gap: 10 }}>
            <Avatar initials="ДК" size={84} />
            <Text style={{ color: '#fff', fontSize: 13 }}>Фото профиля</Text>
          </View>
        </GlassCard>

        <SectionTitle title="ОСНОВНЫЕ ДАННЫЕ" />
        <IOSGroup>
          <FormField label="Имя" value={firstName} onChangeText={setFirstName} />
          <FormField label="Фамилия" value={lastName} onChangeText={setLastName} />
          <FormField label="Еврейское имя" value={hebrewName} onChangeText={setHebrewName} />
          <FormField label="Гражданская дата рождения" value={dob} onChangeText={setDob} />
          <FormField label="Еврейская дата рождения" value={hebrewDob} onChangeText={setHebrewDob} />
          <FormField label="Телефон" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <FormField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
          <FormField label="Город" value={city} onChangeText={setCity} />
          <FormField label="О себе" value={about} onChangeText={setAbout} multiline />
        </IOSGroup>

        <SectionTitle title="ПРОИСХОЖДЕНИЕ" />
        <IOSGroup>
          {tribes.map((item, index) => <ListRow key={item} title={item} rightText={tribe === item ? '✓' : undefined} onPress={() => setTribe(item)} isLast={index === tribes.length - 1} />)}
        </IOSGroup>

        <SectionTitle title="СЕМЕЙНОЕ ПОЛОЖЕНИЕ" />
        <IOSGroup>
          {maritalOptions.map((item, index) => <ListRow key={item} title={item} rightText={marital === item ? '✓' : undefined} onPress={() => setMarital(item)} isLast={index === maritalOptions.length - 1} />)}
        </IOSGroup>

        <SectionTitle title="НАСТРОЙКИ ПРИВАТНОСТИ" />
        <IOSGroup>
          <ListRow title="День рождения" rightText={privacyBirthday} onPress={() => setPrivacyBirthday(privacyBirthday === 'Все участники' ? 'Только раввин' : 'Все участники')} />
          <ListRow title="Телефон" rightText={privacyPhone} onPress={() => setPrivacyPhone(privacyPhone === 'Только раввин' ? 'Все участники' : 'Только раввин')} />
          <ListRow title="Профиль" rightText={privacyProfile} onPress={() => setPrivacyProfile(privacyProfile === 'Публично' ? 'Все участники' : 'Публично')} isLast />
        </IOSGroup>

        <PrimaryButton title="Сохранить" onPress={() => Alert.alert('Профиль сохранён', 'Изменения сохранены локально (mock).')} />
        <GlassCard>
          <ListRow title="Удалить аккаунт" subtitle="Действие необратимо" danger onPress={() => Alert.alert('Удаление аккаунта', 'Функция будет подключена на backend этапе.')} isLast />
        </GlassCard>
      </Screen>
    </>
  );
}
