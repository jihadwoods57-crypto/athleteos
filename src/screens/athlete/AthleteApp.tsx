// OnStandard — athlete app shell: tab content + bottom tab bar + camera FAB +
// full-screen overlays (meal capture/detail, account, messages, notifications).
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '@/store';
import { MAX_FONT_SCALE, shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Txt, Pressable } from '@/ui/primitives';
import { Icon, IconName } from '@/icons';
import { type Tab } from '@/core';
import { Home } from './Home';
import { Plan } from './Plan';
import { Squad } from './Squad';
import { CheckIn } from './CheckIn';
import { Profile } from './Profile';
import { Progress } from './Progress';
import { Reminders } from './Reminders';
import { ScoreBreakdown } from './ScoreBreakdown';
import { Weight } from './Weight';
import { Recovery } from './Recovery';
import { History, Streak, TrustDetail } from './TrustGroup';
import { MealCapture } from '@/screens/overlays/MealCapture';
import { Connect } from '@/screens/overlays/Connect';
import { MealDetail } from '@/screens/overlays/MealDetail';
import { MealHistory } from '@/screens/overlays/MealHistory';
import { MealReview } from '@/screens/overlays/MealReview';
import { Account } from '@/screens/overlays/Account';
import { Plans } from '@/screens/overlays/Plans';
import { Messages } from '@/screens/overlays/Messages';
import { Notifications } from '@/screens/overlays/Notifications';
import { FoodCoach } from '@/screens/overlays/FoodCoach';
import { CoachPlanEditor } from '@/screens/overlays/CoachPlanEditor';
import { isEnginesEnabled, isMealPlansEnabled } from '@/lib/features';

// The redesign's 5-slot bar: Home · Plan · Camera(FAB) · Progress · Profile. Nutrition folds
// into Plan and the leaderboard into Profile (matching the proto); Check-In is reached from
// its Home banner.
const TABS: { tab: Tab; label: string; icon: IconName }[] = [
  { tab: 'home', label: 'Home', icon: 'home' },
  { tab: 'tasks', label: 'Plan', icon: 'plan' },
  { tab: 'progress', label: 'Progress', icon: 'trophy' },
  { tab: 'profile', label: 'Profile', icon: 'user' },
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
  const connectOpen = useStore((s) => s.connectOpen);
  const mealReview = useStore((s) => s.mealReview);
  const initReminders = useStore((s) => s.initReminders);
  const c = useColors();

  // Fire the athlete's daily reminders on launch: requests notification permission (native)
  // and schedules today's active reminders. Without this, reminders only scheduled when the
  // user manually toggled one — so a fresh install never got them. No-op on web.
  //
  // Timing: HELD while the meal overlay is open. On a fresh install, activation opens the
  // first-meal capture immediately — firing the OS notification dialog there stacks it on
  // top of the camera permission at the product's make-or-break moment, which drives
  // denials that gut every reminder after. The effect re-runs when the overlay closes
  // (their first logged meal — a natural "keep me on track?" moment) and it's idempotent.
  useEffect(() => {
    if (mealOpen) return;
    initReminders();
  }, [initReminders, mealOpen]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flex: 1 }}>
        {tab === 'home' && <Home />}
        {tab === 'tasks' && <Plan />}
        {tab === 'squad' && <Squad />}
        {tab === 'checkin' && <CheckIn />}
        {tab === 'progress' && <Progress />}
        {tab === 'reminders' && <Reminders />}
        {tab === 'profile' && <Profile />}
        {tab === 'breakdown' && <ScoreBreakdown />}
        {tab === 'weight' && <Weight />}
        {tab === 'recovery' && <Recovery />}
        {tab === 'history' && <History />}
        {tab === 'streak' && <Streak />}
        {tab === 'trustdetail' && <TrustDetail />}
      </View>

      <TabBar />

      {/* full-screen overlays */}
      {mealOpen && <MealCapture />}
      {mealDetailOpen && <MealDetail />}
      {mealHistoryOpen && <MealHistory />}
      {mealReview && <MealReview />}
      {accountOpen && <Account />}
      {connectOpen && <Connect />}
      {plansOpen && <Plans />}
      {msgOpen && <Messages />}
      {notifOpen && <Notifications />}
      {/* Engine overlays only mount when the master switch is on (defense in depth —
          their entry points are already hidden when off). */}
      {isEnginesEnabled && foodCoachOpen && <FoodCoach />}
      {/* Coach Plan editor mounts under EITHER the engines switch or the meal-plans switch,
          so the Meal Plans feature (its "Prescribed meals" section) is reachable behind its
          own flag without also requiring the accountability engine. */}
      {(isEnginesEnabled || isMealPlansEnabled) && planEditorOpen && <CoachPlanEditor />}
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
  const fourthTab = TABS[3];

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
            { width: 62, height: 62, borderRadius: 31, backgroundColor: c.success, alignItems: 'center', justifyContent: 'center', marginTop: -30 },
            shadow.ctaGreen,
          ]}
        >
          <Icon name="camera" size={26} color={c.onGreen} />
        </Pressable>
      </View>

      <TabItem item={TABS[2]} active={isAthleteTab('tasks')} onPress={() => setTab('tasks')} />
      <TabItem item={fourthTab} active={isAthleteTab(fourthTab.tab)} onPress={() => setTab(fourthTab.tab)} />
    </View>
  );
}

function TabItem({ item, active, onPress }: { item: { label: string; icon: IconName }; active: boolean; onPress: () => void }) {
  const c = useColors();
  const color = active ? c.success : c.textTertiary;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={item.label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 44 }}
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
