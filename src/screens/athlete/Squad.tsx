// OnStandard — Squad tab. Read-only leaderboard; the athlete's row score is live.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { athleteSubtitle, buildLeaderboard, initials, medalColor, squadView, trendInfo, trendSeries, trendSummary } from '@/core';
import { useStore, useDerived } from '@/store';
import { shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Row, SampleTag, Txt, Pressable, Reveal } from '@/ui/primitives';
import { Icon } from '@/icons';

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
          <Row style={[{ gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 11, backgroundColor: c.card }, shadow.card]}>
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
      {/* segmented control */}
      <Row style={[{ marginTop: 18, gap: 6, backgroundColor: c.card, borderRadius: 14, padding: 5 }, shadow.card]}>
        <Seg label="Team" active={squadMode === 'team'} onPress={() => setSquadMode('team')} />
        <Seg label="Linebackers" active={squadMode === 'position'} onPress={() => setSquadMode('position')} />
      </Row>
      <Row style={{ gap: 7, marginTop: 10 }}>
        <SampleTag />
        <Txt w="m" size={13} color={c.textTertiary}>
          {caption}
        </Txt>
      </Row>

      <View style={{ marginTop: 14, gap: 8 }}>
        {board.map((r) => {
          const tr = trendInfo(r.dir);
          return (
            <Row
              key={`${r.rank}-${r.name}`}
              style={[
                {
                  gap: 12,
                  borderRadius: 16,
                  paddingVertical: 13,
                  paddingHorizontal: 15,
                  backgroundColor: r.you ? c.accentSurface : c.card,
                  borderWidth: 1.5,
                  borderColor: r.you ? c.accentBorderStrong : 'transparent',
                },
                r.you ? undefined : shadow.card,
              ]}
            >
              <Txt w="eb" num size={16} color={medalColor(r.rank)} style={{ width: 24, textAlign: 'center' }}>
                {r.rank}
              </Txt>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: r.you ? c.accent : c.bg2, alignItems: 'center', justifyContent: 'center' }}>
                <Txt w="b" size={14} color={r.you ? c.white : c.slate600}>
                  {r.initials}
                </Txt>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Row style={{ gap: 7 }}>
                  <Txt w="b" size={15}>
                    {r.name}
                  </Txt>
                  {r.you ? (
                    <View style={{ backgroundColor: c.accentSurface, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
                      <Txt w="eb" size={10} color={c.accent}>
                        YOU
                      </Txt>
                    </View>
                  ) : null}
                </Row>
                <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 2 }}>
                  {r.pos}
                </Txt>
              </View>
              <Txt w="eb" size={16} color={tr.c}>
                {tr.t}
              </Txt>
              <Txt w="eb" num size={20} style={{ width: 34, textAlign: 'right' }}>
                {r.score}
              </Txt>
            </Row>
          );
        })}
      </View>

      <Txt w="sb" size={12} color={c.textTertiary} style={{ marginTop: 16, textAlign: 'center' }}>
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
}: {
  name: string;
  monogram: string;
  subtitle: string;
  score: number;
  dir: ReturnType<typeof trendSummary>['dir'];
  empty: { title: string; body: string };
}) {
  const c = useColors();
  const tr = trendInfo(dir);
  return (
    <>
      <Txt w="m" size={13} color={c.textTertiary} style={{ marginTop: 18 }}>
        Your week
      </Txt>
      {/* The athlete's own live row — honest while no real peers are connected. */}
      <Row
        style={[
          {
            marginTop: 10,
            gap: 12,
            borderRadius: 16,
            paddingVertical: 13,
            paddingHorizontal: 15,
            backgroundColor: c.accentSurface,
            borderWidth: 1.5,
            borderColor: c.accentBorderStrong,
          },
        ]}
      >
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Txt w="b" size={14} color={c.white}>
            {monogram}
          </Txt>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Row style={{ gap: 7 }}>
            <Txt w="b" size={15}>
              {name}
            </Txt>
            <View style={{ backgroundColor: c.accentSurface, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
              <Txt w="eb" size={10} color={c.accent}>
                YOU
              </Txt>
            </View>
          </Row>
          <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 2 }}>
            {subtitle}
          </Txt>
        </View>
        <Txt w="eb" size={16} color={tr.c} accessibilityLabel={dir === 'up' ? 'Trending up' : dir === 'down' ? 'Trending down' : 'Trend flat'}>
          {tr.t}
        </Txt>
        <Txt w="eb" num size={20} style={{ width: 34, textAlign: 'right' }}>
          {score}
        </Txt>
      </Row>

      {/* Honest empty-peer state: no fabricated teammates for a real athlete. */}
      <View style={[{ marginTop: 14, borderRadius: 16, backgroundColor: c.card, padding: 20, alignItems: 'center' }, shadow.card]}>
        <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="squad" size={22} color={c.textTertiary} />
        </View>
        <Txt w="eb" size={16} style={{ marginTop: 12, textAlign: 'center' }}>
          {empty.title}
        </Txt>
        <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 6, textAlign: 'center', lineHeight: 19 }}>
          {empty.body}
        </Txt>
      </View>
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
      style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: active ? c.accent : 'transparent' }}
    >
      <Txt w="b" size={13} color={active ? c.white : c.textSecondary}>
        {label}
      </Txt>
    </Pressable>
  );
}
