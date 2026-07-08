// OnStandard — Squad tab. Read-only leaderboard; the athlete's row score is live.
// Dark-premium redesign: tier-colored status flags + score chips, elevated rank rows,
// and the same Card/Row/Txt hierarchy Home.tsx establishes. Same data drives it — this
// is a visual port only (every store hook / selector / core helper is preserved).
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { athleteSubtitle, buildLeaderboard, initials, medalColor, squadView, tierFor, trendInfo, trendSeries, trendSummary } from '@/core';
import { useStore, useDerived } from '@/store';
import { shadow, tierChip } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, Row, SampleTag, Txt, Pressable, PressScale, Reveal } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';

/** Compact position abbreviation from the row's full position word — a pure presentation
 *  transform of the existing `pos` string (not new data): initials of each word, capped at
 *  3 chars. "Wide Receiver" → "WR", "Linebacker" → "LB", "Safety" → "S". */
function posAbbr(pos: string): string {
  const words = pos.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) {
    // Single word: keep an established short form (Linebacker→LB, Safety→S), else first 2.
    const w = words[0];
    if (/^linebacker$/i.test(w)) return 'LB';
    if (/^safety$/i.test(w)) return 'S';
    if (/^cornerback$/i.test(w)) return 'CB';
    if (/^quarterback$/i.test(w)) return 'QB';
    return w.slice(0, 2).toUpperCase();
  }
  return words.map((w) => w[0]).join('').slice(0, 3).toUpperCase();
}

export function Squad() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const squadMode = useStore((s) => s.squadMode);
  const setSquadMode = useStore((s) => s.setSquadMode);
  const scoreHistory = useStore((s) => s.scoreHistory);
  const athleteName = useStore((s) => s.athleteName);
  const sport = useStore((s) => s.sport);
  const position = useStore((s) => s.position);
  const d = useDerived();
  // The athlete's own row carries a LIVE score, so its trend arrow should follow
  // the same real score history the Home Score Trend draws — not a frozen
  // constant. Everyone else's arrow stays demo data.
  const youDir = trendSummary(trendSeries(scoreHistory, d.athleteScore)).dir;
  // The you-row name + monogram track the onboarded profile, not the seed.
  const isReal = athleteName.trim().length > 0;
  const youIdentity = isReal
    ? { name: athleteName, initials: initials(athleteName, 'J') }
    : undefined;
  // The seeded peer board, the "Linebackers" room, and the "Visible to Coach
  // Davis" footer are all seed data with no real offline source, so a real
  // athlete sees their own week plus an honest "no squad yet" panel instead.
  const view = squadView({ isReal });

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View>
          <Txt w="sb" size={14} color={c.textSecondary}>
            This week
          </Txt>
          <Txt w="eb" size={28} ls={-0.8} accessibilityRole="header" style={{ marginTop: 1 }}>
            Leaderboard
          </Txt>
        </View>
        {view.showLeague ? (
          <Row style={{ gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder }}>
            <Icon name="trophy" size={14} color={c.accent} />
            <Txt w="b" size={13} color={c.accent}>
              Linebackers
            </Txt>
          </Row>
        ) : null}
      </Row>

      <Reveal index={0}>
      {view.kind === 'solo' && view.empty ? (
        <SoloSquad
          name={athleteName}
          monogram={initials(athleteName, 'J')}
          subtitle={athleteSubtitle(position, sport, isReal)}
          score={d.athleteScore}
          dir={youDir}
          empty={view.empty}
          onConnect={() => useStore.getState().openConnect()}
        />
      ) : (
        <DemoBoard
          squadMode={squadMode}
          setSquadMode={setSquadMode}
          athleteScore={d.athleteScore}
          youDir={youDir}
          youIdentity={youIdentity}
        />
      )}
      </Reveal>
    </ScrollView>
  );
}

/**
 * One leaderboard row — shared by the demo board and the solo you-row so the treatment is
 * identical. The status flag + score chip take the TIER color for that row's score (green
 * OnStandard → cyan Locked In → amber Building → red Off Standard); the current user's row
 * is highlighted. Rank uses the existing medal color for the podium, muted otherwise.
 */
function LeaderRowView({
  rank,
  name,
  monogram,
  pos,
  score,
  dir,
  you,
  dirLabel,
}: {
  rank: number;
  name: string;
  monogram: string;
  pos: string;
  score: number;
  dir: 'up' | 'down' | 'flat';
  you: boolean;
  dirLabel?: string;
}) {
  const c = useColors();
  const tier = tierFor(score);
  const chip = tierChip[tier.short];
  const tr = trendInfo(dir);
  const podium = rank <= 3;
  return (
    <Row
      accessibilityRole="text"
      accessibilityLabel={`Rank ${rank}, ${name}${you ? ' (you)' : ''}, ${pos}, ${tier.name}, score ${score}`}
      style={{
        gap: 12,
        borderRadius: 18,
        paddingVertical: 13,
        paddingHorizontal: 14,
        backgroundColor: you ? c.accentSurface : c.card,
        borderWidth: 1,
        borderColor: you ? c.accentBorderStrong : c.hairline,
      }}
    >
      {/* rank — podium keeps its medal color; the rest sit in a muted numeral */}
      <Txt w="eb" num size={15} color={podium ? medalColor(rank) : c.textTertiary} style={{ width: 22, textAlign: 'center' }}>
        {rank}
      </Txt>

      {/* avatar with a tier-colored status flag dot */}
      <View>
        <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: you ? c.accent : c.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <Txt w="b" size={14} color={you ? c.white : c.slate600}>
            {monogram}
          </Txt>
        </View>
        <View
          style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: chip.fg,
            borderWidth: 2.5,
            borderColor: you ? c.accentSurface : c.card,
          }}
        />
      </View>

      {/* name + position abbreviation */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Row style={{ gap: 7 }}>
          <Txt w="b" size={15} numberOfLines={1} style={{ flexShrink: 1 }}>
            {name}
          </Txt>
          {you ? (
            <View style={{ backgroundColor: c.accent, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
              <Txt w="eb" size={10} color={c.white} ls={0.3}>
                YOU
              </Txt>
            </View>
          ) : null}
        </Row>
        <Row style={{ gap: 6, marginTop: 3 }}>
          <Txt w="eb" size={11} color={c.textTertiary} ls={0.4}>
            {posAbbr(pos)}
          </Txt>
          <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: c.textTertiary, opacity: 0.5 }} />
          <Txt w="sb" size={11.5} color={chip.fg}>
            {tier.name}
          </Txt>
        </Row>
      </View>

      {/* trend arrow */}
      <Txt w="eb" size={15} color={tr.c} accessibilityLabel={dirLabel ?? (dir === 'up' ? 'Trending up' : dir === 'down' ? 'Trending down' : 'Trend flat')}>
        {tr.t}
      </Txt>

      {/* tier-colored score chip */}
      <View style={{ minWidth: 44, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 11, backgroundColor: chip.bg, borderWidth: 1, borderColor: chip.border, alignItems: 'center' }}>
        <Txt w="eb" num size={18} color={chip.fg}>
          {score}
        </Txt>
      </View>
    </Row>
  );
}

function DemoBoard({
  squadMode,
  setSquadMode,
  athleteScore,
  youDir,
  youIdentity,
}: {
  squadMode: 'team' | 'position';
  setSquadMode: (m: 'team' | 'position') => void;
  athleteScore: number;
  youDir: ReturnType<typeof trendSummary>['dir'];
  youIdentity: { name: string; initials: string } | undefined;
}) {
  const c = useColors();
  const board = buildLeaderboard(squadMode, athleteScore, youDir, youIdentity);
  const caption = `${squadMode === 'team' ? 'Full roster' : 'Linebacker room'} · ${board.length} athlete${board.length === 1 ? '' : 's'}`;

  return (
    <>
      {/* scope segmented control — coach-controlled scope of who's visible */}
      <Row style={{ marginTop: 18, gap: 5, backgroundColor: c.surface2, borderRadius: 15, padding: 5, borderWidth: 1, borderColor: c.hairline }}>
        <Seg label="Team" active={squadMode === 'team'} onPress={() => setSquadMode('team')} />
        <Seg label="Linebackers" active={squadMode === 'position'} onPress={() => setSquadMode('position')} />
      </Row>
      <Row style={{ gap: 7, marginTop: 12, marginBottom: 2 }}>
        <SampleTag />
        <Txt w="m" size={13} color={c.textTertiary}>
          {caption}
        </Txt>
      </Row>

      <View style={{ marginTop: 12, gap: 9 }}>
        {board.map((r) => (
          <LeaderRowView
            key={`${r.rank}-${r.name}`}
            rank={r.rank}
            name={r.name}
            monogram={r.initials}
            pos={r.pos}
            score={r.score}
            dir={r.dir}
            you={r.you}
          />
        ))}
      </View>

      <Txt w="sb" size={12} color={c.textTertiary} style={{ marginTop: 18, textAlign: 'center' }}>
        Sample leaderboard · resets Sunday
      </Txt>
    </>
  );
}

function SoloSquad({
  name,
  monogram,
  subtitle,
  score,
  dir,
  empty,
  onConnect,
}: {
  name: string;
  monogram: string;
  subtitle: string;
  score: number;
  dir: ReturnType<typeof trendSummary>['dir'];
  empty: { title: string; body: string };
  onConnect: () => void;
}) {
  const c = useColors();
  const tier = tierFor(score);
  const chip = tierChip[tier.short];
  const tr = trendInfo(dir);
  return (
    <>
      <Txt w="m" size={13} color={c.textTertiary} style={{ marginTop: 18, marginBottom: 2 }}>
        Your week
      </Txt>
      {/* The athlete's own live row — honest while no real peers are connected. Uses the
          same row treatment as the demo board, minus a rank (there's no field to rank in). */}
      <Row
        accessibilityRole="text"
        accessibilityLabel={`${name} (you), ${subtitle}, ${tier.name}, score ${score}`}
        style={{
          marginTop: 10,
          gap: 12,
          borderRadius: 18,
          paddingVertical: 14,
          paddingHorizontal: 15,
          backgroundColor: c.accentSurface,
          borderWidth: 1,
          borderColor: c.accentBorderStrong,
        }}
      >
        <View>
          <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Txt w="b" size={14} color={c.white}>
              {monogram}
            </Txt>
          </View>
          <View
            style={{
              position: 'absolute',
              bottom: -2,
              right: -2,
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: chip.fg,
              borderWidth: 2.5,
              borderColor: c.accentSurface,
            }}
          />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Row style={{ gap: 7 }}>
            <Txt w="b" size={15} numberOfLines={1} style={{ flexShrink: 1 }}>
              {name}
            </Txt>
            <View style={{ backgroundColor: c.accent, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
              <Txt w="eb" size={10} color={c.white} ls={0.3}>
                YOU
              </Txt>
            </View>
          </Row>
          <Row style={{ gap: 6, marginTop: 3 }}>
            <Txt w="m" size={12} color={c.textTertiary} numberOfLines={1} style={{ flexShrink: 1 }}>
              {subtitle}
            </Txt>
            <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: c.textTertiary, opacity: 0.5 }} />
            <Txt w="sb" size={11.5} color={chip.fg}>
              {tier.name}
            </Txt>
          </Row>
        </View>
        <Txt w="eb" size={16} color={tr.c} accessibilityLabel={dir === 'up' ? 'Trending up' : dir === 'down' ? 'Trending down' : 'Trend flat'}>
          {tr.t}
        </Txt>
        <View style={{ minWidth: 44, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 11, backgroundColor: chip.bg, borderWidth: 1, borderColor: chip.border, alignItems: 'center' }}>
          <Txt w="eb" num size={18} color={chip.fg}>
            {score}
          </Txt>
        </View>
      </Row>

      {/* Honest empty-peer state: no fabricated teammates for a real athlete — with a
          real way OUT of the dead end (the audit: the empty state had no CTA). */}
      <Card variant="low" style={{ marginTop: 14, borderRadius: 22, padding: 22, alignItems: 'center' }}>
        <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="squad" size={22} color={c.textTertiary} />
        </View>
        <Txt w="eb" size={16} ls={-0.3} style={{ marginTop: 12, textAlign: 'center' }}>
          {empty.title}
        </Txt>
        <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 6, textAlign: 'center', lineHeight: 19 }}>
          {empty.body}
        </Txt>
        <PressScale
          accessibilityLabel="Connect your team or coach"
          onPress={() => { haptics.tap(); onConnect(); }}
          style={[{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 14, backgroundColor: c.accent, minHeight: 44, justifyContent: 'center' }, shadow.cta]}
        >
          <Txt w="b" size={14} color={c.white}>Enter a team code</Txt>
        </PressScale>
      </Card>
    </>
  );
}

function Seg({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={{ top: 8, bottom: 8 }}
      onPress={onPress}
      style={[
        { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center', backgroundColor: active ? c.accent : 'transparent' },
        active ? shadow.cta : null,
      ]}
    >
      <Txt w="b" size={13} color={active ? c.white : c.textSecondary}>
        {label}
      </Txt>
    </Pressable>
  );
}
