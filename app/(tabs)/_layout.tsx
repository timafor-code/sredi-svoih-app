import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Tabs } from 'expo-router';
import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import {
  AccessibilityInfo,
  Animated,
  DynamicColorIOS,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassTabBarBackground } from '@/components/glass/GlassTabBarBackground';

type TabIconName = ComponentProps<typeof Ionicons>['name'];

type TabConfig = {
  label: string;
  activeIcon: TabIconName;
  inactiveIcon: TabIconName;
};

const TAB_CONFIG: Record<string, TabConfig> = {
  index: { label: 'Главная', activeIcon: 'home', inactiveIcon: 'home-outline' },
  prayers: { label: 'Молитвы', activeIcon: 'time', inactiveIcon: 'time-outline' },
  events: { label: 'События', activeIcon: 'calendar', inactiveIcon: 'calendar-outline' },
  contacts: { label: 'Контакты', activeIcon: 'people', inactiveIcon: 'people-outline' },
  profile: { label: 'Профиль', activeIcon: 'person', inactiveIcon: 'person-outline' },
};

const NATIVE_TAB_CONFIG = {
  index: { label: 'Главная', sf: { default: 'house', selected: 'house.fill' } },
  prayers: { label: 'Молитвы', sf: { default: 'clock', selected: 'clock.fill' } },
  events: { label: 'События', sf: { default: 'calendar', selected: 'calendar.circle.fill' } },
  contacts: { label: 'Контакты', sf: { default: 'person.2', selected: 'person.2.fill' } },
  profile: {
    label: 'Профиль',
    sf: { default: 'person.crop.circle', selected: 'person.crop.circle.fill' },
  },
} as const;

const PANEL_HEIGHT = 82;
const PANEL_BORDER_RADIUS = 32;
const PANEL_HORIZONTAL_INSET = 14;
const INDICATOR_HEIGHT = 54;
const INDICATOR_RADIUS = 24;
const INDICATOR_VERTICAL_INSET = (PANEL_HEIGHT - INDICATOR_HEIGHT) / 2;
const ACTIVE_COLOR = '#F6A400';
const INACTIVE_COLOR = 'rgba(255,255,255,0.52)';
// iOS-style "ease out expo" — fast start, soft settle, no bounce.
const SLIDE_EASING = Easing.bezier(0.32, 0.72, 0, 1);
const MORPH_EASING = SLIDE_EASING;

function GlassTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const indicatorAnim = useRef(new Animated.Value(state.index)).current;
  const morphAnim = useRef(new Animated.Value(0)).current;
  const surfaceAnim = useRef(new Animated.Value(0)).current;
  const tailPositionAnim = useRef(new Animated.Value(state.index)).current;
  const tailPulseAnim = useRef(new Animated.Value(0)).current;
  const previousIndexRef = useRef(state.index);
  const transitionMetaRef = useRef({
    direction: 1,
    distance: 1,
  });
  const [panelWidth, setPanelWidth] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) {
        setReduceMotion(enabled);
      }
    }).catch(() => undefined);
    AccessibilityInfo.isReduceTransparencyEnabled().then((enabled) => {
      if (mounted) {
        setReduceTransparency(enabled);
      }
    }).catch(() => undefined);

    const reduceMotionSubscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    const reduceTransparencySubscription = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReduceTransparency,
    );

    return () => {
      mounted = false;
      reduceMotionSubscription.remove();
      reduceTransparencySubscription.remove();
    };
  }, []);

  if (state.index !== previousIndexRef.current) {
    transitionMetaRef.current = {
      direction: state.index >= previousIndexRef.current ? 1 : -1,
      distance: Math.max(Math.abs(state.index - previousIndexRef.current), 1),
    };
  }

  const transitionMeta = transitionMetaRef.current;

  useEffect(() => {
    const previousIndex = previousIndexRef.current;
    const didChangeTab = state.index !== previousIndex;

    previousIndexRef.current = state.index;

    if (didChangeTab) {
      morphAnim.stopAnimation();
      surfaceAnim.stopAnimation();
      tailPositionAnim.stopAnimation();
      tailPulseAnim.stopAnimation();
      morphAnim.setValue(0);
      surfaceAnim.setValue(0);
      tailPositionAnim.setValue(previousIndex);
      tailPulseAnim.setValue(0);
    }

    const slideAnimation = Animated.timing(indicatorAnim, {
      toValue: state.index,
      duration: reduceMotion ? 140 : 420,
      easing: SLIDE_EASING,
      useNativeDriver: true,
    });

    if (reduceMotion) {
      morphAnim.stopAnimation();
      surfaceAnim.stopAnimation();
      tailPositionAnim.stopAnimation();
      tailPulseAnim.stopAnimation();
      morphAnim.setValue(0);
      surfaceAnim.setValue(0);
      tailPulseAnim.setValue(0);
      tailPositionAnim.setValue(state.index);
      slideAnimation.start();
      return;
    }

    if (!didChangeTab) {
      tailPositionAnim.setValue(state.index);
      slideAnimation.start();
      return;
    }

    Animated.parallel([
      slideAnimation,
      Animated.timing(morphAnim, {
        toValue: 1,
        duration: 460,
        easing: MORPH_EASING,
        useNativeDriver: true,
      }),
      Animated.timing(surfaceAnim, {
        toValue: 1,
        duration: 480,
        easing: MORPH_EASING,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(48),
        Animated.parallel([
          Animated.timing(tailPositionAnim, {
            toValue: state.index,
            duration: 480,
            easing: SLIDE_EASING,
            useNativeDriver: true,
          }),
          Animated.timing(tailPulseAnim, {
            toValue: 1,
            duration: 480,
            easing: MORPH_EASING,
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]).start(({ finished }) => {
      if (finished) {
        morphAnim.setValue(0);
        surfaceAnim.setValue(0);
        tailPulseAnim.setValue(0);
        tailPositionAnim.setValue(state.index);
      }
    });
  }, [
    indicatorAnim,
    morphAnim,
    reduceMotion,
    state.index,
    surfaceAnim,
    tailPositionAnim,
    tailPulseAnim,
  ]);

  const tabCount = state.routes.length;
  const tabWidth = tabCount > 0 ? panelWidth / tabCount : 0;
  const stretchAmount = Math.min(0.28, 0.12 + transitionMeta.distance * 0.045);
  const leadAmount = tabWidth * stretchAmount * 0.42;
  const surfaceTravel = tabWidth * (0.58 + transitionMeta.distance * 0.08);

  const translateX = indicatorAnim.interpolate({
    inputRange: state.routes.map((_, i) => i),
    outputRange: state.routes.map((_, i) => i * tabWidth),
  });
  const tailTranslateX = tailPositionAnim.interpolate({
    inputRange: state.routes.map((_, i) => i),
    outputRange: state.routes.map((_, i) => i * tabWidth),
  });
  const indicatorLead = morphAnim.interpolate({
    inputRange: [0, 0.22, 0.56, 0.84, 1],
    outputRange: [
      0,
      transitionMeta.direction * leadAmount * 0.32,
      transitionMeta.direction * leadAmount,
      transitionMeta.direction * leadAmount * 0.28,
      0,
    ],
  });
  const indicatorTranslateX = Animated.add(translateX, indicatorLead);
  const indicatorScaleX = morphAnim.interpolate({
    inputRange: [0, 0.22, 0.56, 0.84, 1],
    outputRange: [
      1,
      1 + stretchAmount * 0.34,
      1 + stretchAmount,
      1 + stretchAmount * 0.3,
      1,
    ],
  });
  const indicatorScaleY = morphAnim.interpolate({
    inputRange: [0, 0.22, 0.56, 0.84, 1],
    outputRange: [1, 0.97, 0.92, 0.96, 1],
  });
  const wakeScaleX = morphAnim.interpolate({
    inputRange: [0, 0.22, 0.56, 0.84, 1],
    outputRange: [
      1.04,
      1.48,
      2.08 + transitionMeta.distance * 0.08,
      1.52,
      1.08,
    ],
  });
  const wakeScaleY = morphAnim.interpolate({
    inputRange: [0, 0.22, 0.56, 0.84, 1],
    outputRange: [0.78, 0.92, 1.08, 0.94, 0.82],
  });
  const wakeOpacity = morphAnim.interpolate({
    inputRange: [0, 0.24, 0.56, 0.86, 1],
    outputRange: [0, 0.24, 0.62, 0.28, 0],
  });
  const tailOpacity = tailPulseAnim.interpolate({
    inputRange: [0, 0.22, 0.58, 0.86, 1],
    outputRange: [0, 0.22, 0.46, 0.26, 0],
  });
  const tailScaleX = tailPulseAnim.interpolate({
    inputRange: [0, 0.22, 0.58, 0.86, 1],
    outputRange: [
      0.92,
      1.36,
      2.16 + transitionMeta.distance * 0.12,
      1.52,
      1.12,
    ],
  });
  const tailScaleY = tailPulseAnim.interpolate({
    inputRange: [0, 0.22, 0.58, 0.86, 1],
    outputRange: [0.7, 0.86, 1.08, 0.92, 0.78],
  });
  const distortionOpacity = tailPulseAnim.interpolate({
    inputRange: [0, 0.24, 0.58, 0.9, 1],
    outputRange: [0, 0.18, 0.52, 0.18, 0],
  });
  const distortionScaleX = tailPulseAnim.interpolate({
    inputRange: [0, 0.24, 0.58, 0.9, 1],
    outputRange: [
      0.96,
      1.44,
      2.38 + transitionMeta.distance * 0.14,
      1.58,
      1.16,
    ],
  });
  const distortionScaleY = tailPulseAnim.interpolate({
    inputRange: [0, 0.24, 0.58, 0.9, 1],
    outputRange: [0.72, 0.9, 1.16, 0.92, 0.78],
  });
  const surfaceTranslateX = surfaceAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [
      -transitionMeta.direction * surfaceTravel,
      transitionMeta.direction * surfaceTravel,
    ],
  });
  const surfaceOpacity = morphAnim.interpolate({
    inputRange: [0, 0.24, 0.58, 0.88, 1],
    outputRange: [0, 0.34, 0.96, 0.42, 0],
  });
  const crownOpacity = morphAnim.interpolate({
    inputRange: [0, 0.24, 0.58, 0.88, 1],
    outputRange: [0.34, 0.54, 0.92, 0.56, 0.34],
  });
  const crownTranslateX = surfaceAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [
      -transitionMeta.direction * tabWidth * 0.12,
      transitionMeta.direction * tabWidth * 0.12,
    ],
  });

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    if (width !== panelWidth) {
      setPanelWidth(width);
    }
  };

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        { bottom: Math.max(insets.bottom, 8) + 4 },
      ]}
    >
      <View style={styles.panel} onLayout={handleLayout}>
        <GlassTabBarBackground
          radius={PANEL_BORDER_RADIUS}
          reduceTransparency={reduceTransparency}
        />
        {tabWidth > 0 ? (
          <>
            {!reduceTransparency ? (
              <>
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.surfaceTail,
                    {
                      opacity: tailOpacity,
                      width: tabWidth,
                      transform: [
                        { translateX: tailTranslateX },
                        { scaleX: tailScaleX },
                        { scaleY: tailScaleY },
                      ],
                    },
                  ]}
                >
                  <BlurView
                    tint="light"
                    intensity={34}
                    style={StyleSheet.absoluteFillObject}
                  />
                  <LinearGradient
                    colors={[
                      'rgba(255,255,255,0)',
                      'rgba(255,255,255,0.24)',
                      'rgba(246,164,0,0.14)',
                      'rgba(255,255,255,0)',
                    ]}
                    locations={[0, 0.32, 0.66, 1]}
                    start={{ x: 0, y: 0.08 }}
                    end={{ x: 1, y: 0.9 }}
                    style={StyleSheet.absoluteFillObject}
                  />
                </Animated.View>
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.surfaceDistortion,
                    {
                      opacity: distortionOpacity,
                      width: tabWidth,
                      transform: [
                        { translateX: tailTranslateX },
                        { scaleX: distortionScaleX },
                        { scaleY: distortionScaleY },
                      ],
                    },
                  ]}
                >
                  <LinearGradient
                    colors={[
                      'rgba(255,255,255,0)',
                      'rgba(255,255,255,0.26)',
                      'rgba(255,255,255,0.08)',
                      'rgba(246,164,0,0.10)',
                      'rgba(255,255,255,0)',
                    ]}
                    locations={[0, 0.2, 0.43, 0.7, 1]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFillObject}
                  />
                </Animated.View>
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.surfaceWake,
                    {
                      opacity: wakeOpacity,
                      width: tabWidth,
                      transform: [
                        { translateX: indicatorTranslateX },
                        { scaleX: wakeScaleX },
                        { scaleY: wakeScaleY },
                      ],
                    },
                  ]}
                >
                  <LinearGradient
                    colors={[
                      'rgba(255,255,255,0)',
                      'rgba(255,255,255,0.30)',
                      'rgba(246,164,0,0.14)',
                      'rgba(255,255,255,0)',
                    ]}
                    locations={[0, 0.36, 0.66, 1]}
                    start={{ x: 0, y: 0.1 }}
                    end={{ x: 1, y: 0.9 }}
                    style={StyleSheet.absoluteFillObject}
                  />
                </Animated.View>
              </>
            ) : null}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.indicatorOuter,
                {
                  width: tabWidth,
                  transform: [
                    { translateX: indicatorTranslateX },
                    { scaleX: indicatorScaleX },
                    { scaleY: indicatorScaleY },
                  ],
                },
              ]}
            >
              <View style={styles.indicatorClip}>
                <BlurView
                  tint="light"
                  intensity={55}
                  style={StyleSheet.absoluteFillObject}
                />
                <LinearGradient
                  colors={[
                    'rgba(255,255,255,0.52)',
                    'rgba(255,255,255,0.16)',
                    'rgba(246,164,0,0.20)',
                  ]}
                  locations={[0, 0.55, 1]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={StyleSheet.absoluteFillObject}
                />
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.surfaceCrown,
                    {
                      opacity: crownOpacity,
                      transform: [{ translateX: crownTranslateX }],
                    },
                  ]}
                >
                  <LinearGradient
                    colors={[
                      'rgba(255,255,255,0.56)',
                      'rgba(255,255,255,0.18)',
                      'rgba(255,255,255,0)',
                    ]}
                    locations={[0, 0.58, 1]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0.8, y: 1 }}
                    style={StyleSheet.absoluteFillObject}
                  />
                </Animated.View>
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.surfaceGlide,
                    {
                      opacity: surfaceOpacity,
                      transform: [{ translateX: surfaceTranslateX }],
                    },
                  ]}
                >
                  <LinearGradient
                    colors={[
                      'rgba(255,255,255,0)',
                      'rgba(255,255,255,0.58)',
                      'rgba(246,164,0,0.16)',
                      'rgba(255,255,255,0)',
                    ]}
                    locations={[0, 0.38, 0.58, 1]}
                    start={{ x: 0, y: 0.15 }}
                    end={{ x: 1, y: 0.85 }}
                    style={StyleSheet.absoluteFillObject}
                  />
                </Animated.View>
                <View style={styles.indicatorTint} />
                <View pointerEvents="none" style={styles.indicatorBorder} />
              </View>
            </Animated.View>
          </>
        ) : null}
        <View style={styles.row}>
          {state.routes.map((route, index) => {
            const config = TAB_CONFIG[route.name];
            if (!config) {
              return null;
            }
            const focused = state.index === index;
            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name, route.params);
              }
            };
            const onLongPress = () => {
              navigation.emit({
                type: 'tabLongPress',
                target: route.key,
              });
            };
            const tabFocusProgress = indicatorAnim.interpolate({
              inputRange: state.routes.map((_, i) => i),
              outputRange: state.routes.map((_, i) => (i === index ? 1 : 0)),
              extrapolate: 'clamp',
            });
            const tabOpacity = tabFocusProgress.interpolate({
              inputRange: [0, 1],
              outputRange: [0.76, 1],
            });
            const tabScale = tabFocusProgress.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 1.04],
            });
            const tabLift = tabFocusProgress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, -1.5],
            });
            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityState={focused ? { selected: true } : {}}
                accessibilityLabel={config.label}
                hitSlop={4}
                onPress={onPress}
                onLongPress={onLongPress}
                style={styles.tabButton}
              >
                <Animated.View
                  style={[
                    styles.tabContent,
                    {
                      opacity: tabOpacity,
                      transform: [{ translateY: tabLift }, { scale: tabScale }],
                    },
                  ]}
                >
                  <Ionicons
                    name={focused ? config.activeIcon : config.inactiveIcon}
                    size={22}
                    color={focused ? ACTIVE_COLOR : INACTIVE_COLOR}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.tabLabel,
                      focused ? styles.tabLabelActive : null,
                    ]}
                  >
                    {config.label}
                  </Text>
                </Animated.View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

export default function TabsLayout() {
  if (Platform.OS === 'ios') {
    const adaptiveTabColor = DynamicColorIOS({
      dark: '#FFFFFF',
      light: '#111111',
    });

    return (
      <NativeTabs
        backgroundColor="transparent"
        blurEffect="systemChromeMaterial"
        iconColor={{
          default: adaptiveTabColor,
          selected: ACTIVE_COLOR,
        }}
        labelStyle={{
          default: {
            color: adaptiveTabColor,
            fontSize: 11,
            fontWeight: '500',
          },
          selected: {
            color: ACTIVE_COLOR,
            fontSize: 11,
            fontWeight: '600',
          },
        }}
        minimizeBehavior="onScrollDown"
        shadowColor="rgba(0,0,0,0.22)"
        tintColor={ACTIVE_COLOR}
      >
        {Object.entries(NATIVE_TAB_CONFIG).map(([name, config]) => (
          <NativeTabs.Trigger key={name} name={name}>
            <Icon sf={config.sf} selectedColor={ACTIVE_COLOR} />
            <Label>{config.label}</Label>
          </NativeTabs.Trigger>
        ))}
      </NativeTabs>
    );
  }

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <GlassTabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: 'Главная' }} />
      <Tabs.Screen name="prayers" options={{ title: 'Молитвы' }} />
      <Tabs.Screen name="events" options={{ title: 'События' }} />
      <Tabs.Screen name="contacts" options={{ title: 'Контакты' }} />
      <Tabs.Screen name="profile" options={{ title: 'Профиль' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: PANEL_HORIZONTAL_INSET,
    right: PANEL_HORIZONTAL_INSET,
    height: PANEL_HEIGHT,
  },
  panel: {
    flex: 1,
    borderRadius: PANEL_BORDER_RADIUS,
    backgroundColor: 'transparent',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  surfaceWake: {
    position: 'absolute',
    top: INDICATOR_VERTICAL_INSET - 12,
    left: 0,
    height: INDICATOR_HEIGHT + 24,
    borderRadius: INDICATOR_RADIUS + 14,
    overflow: 'hidden',
  },
  surfaceTail: {
    position: 'absolute',
    top: INDICATOR_VERTICAL_INSET - 10,
    left: 0,
    height: INDICATOR_HEIGHT + 20,
    borderRadius: INDICATOR_RADIUS + 12,
    overflow: 'hidden',
  },
  surfaceDistortion: {
    position: 'absolute',
    top: INDICATOR_VERTICAL_INSET - 14,
    left: 0,
    height: INDICATOR_HEIGHT + 28,
    borderRadius: INDICATOR_RADIUS + 16,
    overflow: 'hidden',
  },
  // Outer carries the gold glow shadow — must NOT have overflow:hidden
  // or the shadow gets clipped on iOS.
  indicatorOuter: {
    position: 'absolute',
    top: INDICATOR_VERTICAL_INSET,
    left: 0,
    height: INDICATOR_HEIGHT,
    shadowColor: ACTIVE_COLOR,
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  // Inner clip rounds and contains the BlurView + gradient layers.
  indicatorClip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: INDICATOR_RADIUS,
    overflow: 'hidden',
  },
  surfaceCrown: {
    position: 'absolute',
    top: 0,
    left: -18,
    right: -18,
    height: 30,
  },
  surfaceGlide: {
    position: 'absolute',
    top: 2,
    bottom: 4,
    left: -34,
    right: -34,
    borderRadius: INDICATOR_RADIUS,
    overflow: 'hidden',
  },
  indicatorTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(246,164,0,0.10)',
  },
  indicatorBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: INDICATOR_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(246,164,0,0.34)',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  tabButton: {
    flex: 1,
    height: PANEL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tabLabel: {
    color: INACTIVE_COLOR,
    fontSize: 11,
    fontWeight: '500',
    includeFontPadding: false,
    textAlign: 'center',
  },
  tabLabelActive: {
    color: ACTIVE_COLOR,
    fontWeight: '600',
  },
});
