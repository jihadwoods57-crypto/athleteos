// OnStandard — Performance Profile view (doc-05 §4). Coach-facing: the portable read-only picture of
// an athlete — consistency from score history, preferences from CONFIRMED memory facts, deterministic
// strengths/weaknesses, and coach feedback. buildProfileView invents nothing; RLS only returns
// coach-visible facts. Renders nothing until there's something to show.
import React from 'react';
import { View } from 'react-native';
import { fetchFactsFor, fetchProfileRow } from '@/lib/ai/memory';
import { buildProfileView, type PerformanceProfileView } from '@/core';
import { useColors } from '@/ui/theme';
import { Card, Row, Txt } from '@/ui/primitives';
import { Icon } from '@/icons';

function Chips({ label, items, tone }: { label: string; items: string[]; tone: string }) {
  const c = useColors();
  if (items.length === 0) return null;
  return (
    <View style={{ marginTop: 12 }}>
      <Txt w="eb" size={10} color={c.textTertiary} ls={0.5} style={{ marginBottom: 7 }}>{label}</Txt>
      <Row style={{ flexWrap: 'wrap', gap: 7 }}>
        {items.map((it) => (
          <View key={it} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: tone }}>
            <Txt w="b" size={12} color={c.slate700}>{it}</Txt>
          </View>
        ))}
      </Row>
    </View>
  );
}

export function AthleteProfileView({ athleteId, recentScores = [] }: { athleteId: string; recentScores?: number[] }) {
  const c = useColors();
  const [view, setView] = React.useState<PerformanceProfileView | null>(null);
  const scoreKey = recentScores.join(',');

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const [facts, row] = await Promise.all([fetchFactsFor(athleteId), fetchProfileRow(athleteId)]);
      if (!alive) return;
      setView(buildProfileView({ athleteId, recentScores, facts, profileRow: row }));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId, scoreKey]);

  if (!view) return null;
  const { consistency, preferences, strengths, weaknesses, feedback } = view;
  const empty =
    !preferences.allergies.length && !preferences.dislikes.length && !preferences.favoriteFoods.length &&
    !strengths.length && !weaknesses.length && !feedback.length && consistency.last7 === 0;
  if (empty) return null;

  return (
    <Card variant="low" style={{ borderRadius: 20, marginTop: 14 }}>
      <Row style={{ gap: 9, marginBottom: 12, alignItems: 'center' }}>
        <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="user" size={16} color={c.accent} />
        </View>
        <Txt w="eb" size={12} color={c.accent} ls={0.4}>PERFORMANCE PROFILE</Txt>
      </Row>

      {consistency.last7 > 0 ? (
        <Txt w="sb" size={14} color={c.slate700} style={{ lineHeight: 20 }}>
          {consistency.last7} avg last 7 days · {consistency.last30} last 30 · trending {consistency.trend}.
        </Txt>
      ) : null}

      {strengths.length ? <Chips label="STRENGTHS" items={strengths} tone={c.successSurface} /> : null}
      {weaknesses.length ? <Chips label="WATCH" items={weaknesses} tone={c.alertSurface} /> : null}
      {preferences.allergies.length ? <Chips label="ALLERGIES" items={preferences.allergies} tone={c.alertSurface} /> : null}
      {preferences.dislikes.length ? <Chips label="DISLIKES" items={preferences.dislikes} tone={c.bg2} /> : null}
      {preferences.favoriteFoods.length ? <Chips label="FAVORITES" items={preferences.favoriteFoods} tone={c.bg2} /> : null}

      {feedback.length ? (
        <View style={{ marginTop: 14 }}>
          <Txt w="eb" size={10} color={c.textTertiary} ls={0.5} style={{ marginBottom: 6 }}>LATEST FEEDBACK</Txt>
          <Txt w="m" size={13} color={c.slate700} style={{ lineHeight: 19 }}>{feedback[feedback.length - 1].text}</Txt>
        </View>
      ) : null}
    </Card>
  );
}
