// OnStandard — Client meal history overlay (Part B). "See past meal uploads."
// Lists the athlete's own stored meals grouped by day when the backend is live;
// offline/demo it falls back to today's locally-logged meals (real logs, never
// fabricated). An empty day reads an honest empty state.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { groupMealsByDay, localTodayCards, todayStamp, type MealCard, type MealHistoryDay } from '@/core';
import { useStore } from '@/store';
import { isBackendLive } from '@/lib/supabase';
import { Card, Reveal, Row, SampleTag, Txt } from '@/ui/primitives';
import { useColors } from '@/ui/theme';
import { Icon } from '@/icons';
import { Overlay } from './Overlay';
import { MealCardItem } from './MealCardItem';

export function MealHistory() {
  const c = useColors();
  const s = useStore();
  // Live: real stored meals grouped by day. Offline/demo: today's logged meals, so
  // the overlay is useful before the backend is on (and honest — these are real logs).
  const days: MealHistoryDay[] =
    s.mealHistory != null
      ? groupMealsByDay(s.mealHistory, todayStamp())
      : wrapToday(localTodayCards(s));
  const isEmpty = days.every((d) => d.cards.length === 0);

  return (
    <Overlay title="Meal History" onClose={s.closeMealHistory}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {!isBackendLive ? (
          <Row style={{ gap: 9, alignItems: 'flex-start', marginTop: 4, marginBottom: 16, padding: 13, borderRadius: 14, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline }}>
            <SampleTag />
            <Txt w="sb" size={12} color={c.textSecondary} style={{ flex: 1, lineHeight: 17 }}>
              Showing today’s logged meals. Your full history across days appears here once your account is connected.
            </Txt>
          </Row>
        ) : null}

        {isEmpty ? <EmptyState /> : days.map((day, i) => <DaySection key={day.dateKey} day={day} index={i} />)}
      </ScrollView>
    </Overlay>
  );
}

function DaySection({ day, index = 0 }: { day: MealHistoryDay; index?: number }) {
  const c = useColors();
  const s = useStore();
  if (day.cards.length === 0) return null;
  return (
    <Reveal index={index}>
      <View style={{ marginBottom: 20 }}>
        {/* section eyebrow — the Home/day-group idiom: extra-bold, tracked, muted, with a
            count so the day reads at a glance */}
        <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, marginHorizontal: 4 }}>
          <Txt w="eb" size={12} color={c.textTertiary} ls={0.7}>
            {day.dayLabel.toUpperCase()}
          </Txt>
          <Txt w="sb" size={12} color={c.textTertiary}>
            {day.cards.length} meal{day.cards.length === 1 ? '' : 's'}
          </Txt>
        </Row>
        <Card variant="low" style={{ borderRadius: 20, padding: 6 }}>
          {day.cards.map((card, i) => (
            <View
              key={card.id}
              style={
                i > 0
                  ? { borderTopWidth: 1, borderTopColor: c.hairline }
                  : undefined
              }
            >
              <View style={{ paddingHorizontal: 10, paddingVertical: 12 }}>
                <MealCardItem
                  card={card}
                  // Stored meals open the SAME review + thread surface the coach uses — the
                  // athlete reads and replies to coach comments on the exact meal (0046). A
                  // local-only card (no serverId: demo / offline) opens the review in demo
                  // mode so the flow is visible either way.
                  onPress={
                    card.serverId && s.userId
                      ? () => s.openMealReview(card.serverId!, s.userId!, s.athleteName || 'You', card, false)
                      : () => s.openMealReview(card.id, s.userId ?? 'me', s.athleteName || 'You', card, true)
                  }
                />
              </View>
            </View>
          ))}
        </Card>
      </View>
    </Reveal>
  );
}

function EmptyState() {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', paddingTop: 64, paddingHorizontal: 24 }}>
      <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="camera" size={28} color={c.textTertiary} />
      </View>
      <Txt w="eb" size={17} ls={-0.3} style={{ marginTop: 16 }}>
        No meals yet
      </Txt>
      <Txt w="m" size={14} color={c.textSecondary} style={{ marginTop: 6, textAlign: 'center', lineHeight: 21 }}>
        Log a meal and it’ll show up here — photo, macros, and quality, day by day.
      </Txt>
    </View>
  );
}

/** Wrap the offline/demo cards (all "today") in a single day section. */
function wrapToday(cards: MealCard[]): MealHistoryDay[] {
  return [{ dateKey: todayStamp(), dayLabel: 'Today', cards }];
}
