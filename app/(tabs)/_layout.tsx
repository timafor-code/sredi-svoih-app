import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GlassTabBarBackground } from '@/components/glass/GlassTabBarBackground';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: '#F07A2A', tabBarStyle: { position: 'absolute' }, tabBarBackground: GlassTabBarBackground }}>
      <Tabs.Screen name="index" options={{ title: 'Главная', tabBarIcon: ({ color }) => <Ionicons name="home" size={20} color={color} /> }} />
      <Tabs.Screen name="prayers" options={{ title: 'Молитвы', tabBarIcon: ({ color }) => <Ionicons name="time" size={20} color={color} /> }} />
      <Tabs.Screen name="events" options={{ title: 'События', tabBarIcon: ({ color }) => <Ionicons name="calendar" size={20} color={color} /> }} />
      <Tabs.Screen name="contacts" options={{ title: 'Контакты', tabBarIcon: ({ color }) => <Ionicons name="people" size={20} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Профиль', tabBarIcon: ({ color }) => <Ionicons name="person" size={20} color={color} /> }} />
    </Tabs>
  );
}
