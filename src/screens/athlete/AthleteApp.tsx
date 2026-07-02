// OnStandard — athlete app shell: tab content + bottom tab bar + camera FAB +
// full-screen overlays (meal capture/detail, account, messages, notifications).
import React from 'react';
import { View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '@/store';
import { MAX_FONT_SCALE, shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Txt, Pressable } from '@/ui/primitives';
import { Icon, IconName } from '@/icons';
import type { Tab } from '@/core';
import { Home } from './Home';
import { Plan } from './Plan';
import { Squad } from './Squad';
import { CheckIn } from './CheckIn';
import { Nutrition } from './Nutrition';
import { Profile } from './Profile';
import { Performance } from './Performance';
import { Reminders } from './Reminders';
import { MealCapture } from '@/screens/overlays/MealCapture';
import { Connect } from '@/screens/overlays/Connect';
import { MealDetail } from '@/screens/overlays/MealDetail';
import { MealHistory } from '@/screens/overlays/MealHistory';
import { NutritionMemory } from '@/screens/overlays/NutritionMemory';
import { Account } from '@/screens/overlays/Account';
import { Plans } from '@/screens/overlays/Plans';
import { Messages } from '@/screens/overlays/Messages';
import { Notifications } from '@/screens/overlays/Notifications';
import { FoodCoach } from '@/screens/overlays/FoodCoach';
import { CoachPlanEditor } from '@/screens/overlays/CoachPlanEditor';
import { isEnginesEnabled } from '@/lib/features';

// Nutrition is the core daily surface, so it gets a tab (was buried behind a Home card).
// Check-In is reached from its Home banner; Profile via the header avatar.
const TABS: { tab: Tab; label: string; icon: IconName }[] = [
  { tab: 'home', label: 'Home', icon: 'home' },
  { tab: 'nutrition', label: 'Nutrition', icon: 'utensils' },
  { tab: 'tasks', label: 'Plan', icon: 'plan' },
  { tab: 'squad', label: 'Squad', icon: 'squad' },
];

export function AthleteApp() {
  const tab = useStore((s) => s.tab);
  const mealOpen = useStore((s) => s.mealOpen);
  const mealDetailOpen = useStore((s) => s.mealDetailOpen);
  const accountOpen = useStore((s) => s.accountOpen);
  const plansOpen = useStore((s) => s.plansOpen);
  const msgOpen = useStore((s) => s.msgOpen);
  const notifOpen = useStore((s) => s.notifOpen);
  const foodCoachOpen = useStore((s) => s.foodCoachOpen);
  const planEditorOpen = useStore((s) => s.planEditorOpen);
  const mealHistoryOpen = useStore((s) => s.mealHistoryOpen);
  const nutritionMemoryOpen = useStore((s) => s.nutritionMemoryOpen);
  const connectOpen = useStore((s) => s.connectOpen);
  const c = useColors();

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flex: 1 }}>
        {tab === 'home' && <Home />}
        {tab === 'tasks' && <Plan />}
        {tab === 'squad' && <Squad />}
        {tab === 'checkin' && <CheckIn />}
        {tab === 'nutrition' && <Nutrition />}
        {tab === 'performance' && <Performance />}
        {tab === 'reminders' && <Reminders />}
        {tab === 'profile' && <Profile />}
      </View>

      <TabBar />

      {/* full-screen overlays */}
      {mealOpen && <MealCapture />}
      {mealDetailOpen && <MealDetail />}
      {mealHistoryOpen && <MealHistory />}
      {nutritionMemoryOpen && <NutritionMemory />}
      {accountOpen && <Account />}
      {connectOpen && <Connect />}
      {plansOpen && <Plans />}
      {msgOpen && <Messages />}
      {notifOpen && <Notifications />}
      {/* Engine overlays only mount when the master switch is on (defense in depth —
          their entry points are already hidden when off). */}
      {isEnginesEnabled && foodCoachOpen && <FoodCoach />}
      {isEnginesEnabled && planEditorOpen && <CoachPlanEditor />}
    </View>
  );
}

function TabBar() {
  const insets = useSafeAreaInsets();
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const openMeal = useStore((s) => s.openMeal);
  const c = useColors();

  const isAthleteTab = (t: Tab) => tab === t;

  return (
    <View
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingBottom: Math.max(insets.bottom, 10),
          paddingTop: 10,
          backgroundColor: c.card,
          flexDirection: 'row',
          alignItems: 'center',
          borderTopWidth: 1,
          borderTopColor: c.border,
        },
      ]}
    >
      <TabItem item={TABS[0]} active={isAthleteTab('home')} onPress={() => setTab('home')} />
      <TabItem item={TABS[1]} active={isAthleteTab('nutrition')} onPress={() => setTab('nutrition')} />

      {/* center camera FAB */}
      <View style={{ width: 72, alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log a meal"
          onPress={openMeal}
          style={[
            { width: 58, height: 58, borderRadius: 18, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', marginTop: -28 },
            shadow.cta,
          ]}
        >
          <Icon name="camera" size={26} color={c.white} />
        </Pressable>
      </View>

      <TabItem item={TABS[2]} active={isAthleteTab('tasks')} onPress={() => setTab('tasks')} />
      <TabItem item={TABS[3]} active={isAthleteTab('squad')} onPress={() => setTab('squad')} />
    </View>
  );
}

function TabItem({ item, active, onPress }: { item: { label: string; icon: IconName }; active: boolean; onPress: () => void }) {
  const c = useColors();
  const color = active ? c.accent : c.textTertiary;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={item.label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{ flex: 1, alignItems: 'center', gap: 4 }}
    >
      <Icon name={item.icon} size={23} color={color} />
      <Txt w={active ? 'b' : 'sb'} size={11} color={color} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {item.label}
      </Txt>
    </Pressable>
  );
}

/** Shared header used by athlete sub-screens. */
export function AthleteHeader({ children }: { children: React.ReactNode }) {
  return <SafeAreaView edges={['top']}>{children}</SafeAreaView>;
}
