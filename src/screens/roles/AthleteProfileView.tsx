// OnStandard — Performance Profile view (doc-05 §4). Coach-facing: the portable read-only picture of
// an athlete — consistency from score history, preferences from CONFIRMED memory facts, deterministic
// strengths/weaknesses, and coach feedback. buildProfileView invents nothing; RLS only returns
// coach-visible facts. Renders nothing until there's something to show.
import React from 'react';
import { View } from 'react-native';
import { fetchFactsFor, fetchProfileRow } from '@/lib/ai/memory';
import { buildProfileView, tierFor, type PerformanceProfileView } from '@/core';
import { tierChip } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, Row, Txt } from '@/ui/primitives';
import { Icon } from '@/icons';

/** A hairline-framed chip group with an eyebrow. Filled tint + a matching hairline so the
 *  chips read as edges on the dark canvas, not floating blocks. Border tone tracks the fill. */
function Chips({ label, items, tone, border }: { label: string; items: string[]; tone: string; border: string }) {
  const c = useColors();
  if (items.length === 0) return null;
  return (
    <View style={{ marginTop: 14 }}>
      <Txt w="eb" size={10} color={c.textTertiary} ls={0.6} style={{ marginBottom: 8 }}>{label}</Txt>
      <Row style={{ flexWrap: 'wrap', gap: 7 }}>
        {items.map((it) => (
          <View key={it} style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 9, backgroundColor: tone, borderWidth: 1, borderColor: border }}>
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

  // The 7-day average is a 0-100 score, so its stat tile takes tier coloring.
  const chip = consistency.last7 > 0 ? tierChip[tierFor(consistency.last7).short] : null;

  return (
    <Card variant="low" style={{ borderRadius: 20, marginTop: 14 }}>
      <Row style={{ gap: 10, marginBottom: 14, alignItems: 'center' }}>
        <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="user" size={16} color={c.accent} />
        </View>
        <Txt w="eb" size={11} color={c.textTertiary} ls={0.8}>PERFORMANCE PROFILE</Txt>
      </Row>

      {consistency.last7 > 0 && chip ? (
        <Row style={{ gap: 10, alignItems: 'stretch' }}>
          {/* Tier-colored headline stat: the 7-day average leads, framed like every other
              score chip in the app. The trailing prose keeps the 30-day + trend context. */}
          <View style={{ paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: chip.bg, borderWidth: 1, borderColor: chip.border, alignItems: 'center', justifyContent: 'center', minWidth: 76 }}>
            <Txt w="eb" num size={26} color={chip.fg}>{consistency.last7}</Txt>
            <Txt w="b" size={10} color={chip.fg} ls={0.4} style={{ marginTop: 2 }}>7-DAY AVG</Txt>
          </View>
          <View style={{ flex: 1, justifyContent: 'center', backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 }}>
            <Txt w="sb" size={13.5} color={c.slate700} style={{ lineHeight: 19 }}>
              {consistency.last30} avg last 30 days · trending {consistency.trend}.
            </Txt>
          </View>
        </Row>
      ) : null}

      {strengths.length ? <Chips label="STRENGTHS" items={strengths} tone={c.successSurface} border={c.successBorderSoft} /> : null}
      {weaknesses.length ? <Chips label="WATCH" items={weaknesses} tone={c.alertSurface} border={c.alertBorder} /> : null}
      {preferences.allergies.length ? <Chips label="ALLERGIES" items={preferences.allergies} tone={c.alertSurface} border={c.alertBorder} /> : null}
      {preferences.dislikes.length ? <Chips label="DISLIKES" items={preferences.dislikes} tone={c.surface2} border={c.hairline} /> : null}
      {preferences.favoriteFoods.length ? <Chips label="FAVORITES" items={preferences.favoriteFoods} tone={c.surface2} border={c.hairline} /> : null}

      {feedback.length ? (
        <View style={{ marginTop: 16, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, borderRadius: 14, padding: 13 }}>
          <Txt w="eb" size={10} color={c.textTertiary} ls={0.6} style={{ marginBottom: 6 }}>LATEST FEEDBACK</Txt>
          <Txt w="m" size={13} color={c.slate700} style={{ lineHeight: 19 }}>{feedback[feedback.length - 1].text}</Txt>
        </View>
      ) : null}
    </Card>
  );
}
