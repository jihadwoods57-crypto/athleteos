// AthleteOS — Squad tab. Read-only leaderboard; the athlete's row score is live.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildLeaderboard, initials, medalColor, trendInfo, trendSeries, trendSummary } from '@/core';
import { useStore, useDerived } from '@/store';
import { colors, shadow } from '@/ui/tokens';
import { Row, Txt, Pressable } from '@/ui/primitives';
import { Icon } from '@/icons';

export function Squad() {
  const insets = useSafeAreaInsets();
  const squadMode = useStore((s) => s.squadMode);
  const setSquadMode = useStore((s) => s.setSquadMode);
  const scoreHistory = useStore((s) => s.scoreHistory);
  const athleteName = useStore((s) => s.athleteName);
  const d = useDerived();
  // The athlete's own row carries a LIVE score, so its trend arrow should follow
  // the same real score history the Home Score Trend draws — not a frozen
  // constant. Everyone else's arrow stays demo data.
  const youDir = trendSummary(trendSeries(scoreHistory, d.athleteScore)).dir;
  // The you-row name + monogram track the onboarded profile, not the seed.
  const youIdentity = athleteName
    ? { name: athleteName, initials: initials(athleteName, 'J') }
    : undefined;
  const board = buildLeaderboard(squadMode, d.athleteScore, youDir, youIdentity);
  const caption = `${squadMode === 'team' ? 'Full roster' : 'Linebacker room'} · ${board.length} athlete${board.length === 1 ? '' : 's'}`;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View>
          <Txt w="sb" size={14} color={colors.textSecondary}>
            This week
          </Txt>
          <Txt w="eb" size={28} ls={-0.8} style={{ marginTop: 1 }}>
            Leaderboard
          </Txt>
        </View>
        <Row style={[{ gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 11, backgroundColor: '#fff' }, shadow.card]}>
          <Icon name="trophy" size={14} color={colors.accent} />
          <Txt w="b" size={13} color={colors.accent}>
            Linebackers
          </Txt>
        </Row>
      </Row>

      {/* segmented control */}
      <Row style={[{ marginTop: 18, gap: 6, backgroundColor: '#fff', borderRadius: 14, padding: 5 }, shadow.card]}>
        <Seg label="Team" active={squadMode === 'team'} onPress={() => setSquadMode('team')} />
        <Seg label="Linebackers" active={squadMode === 'position'} onPress={() => setSquadMode('position')} />
      </Row>
      <Txt w="m" size={13} color={colors.textTertiary} style={{ marginTop: 10 }}>
        {caption}
      </Txt>

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
                  backgroundColor: r.you ? colors.accentSurface : '#fff',
                  borderWidth: 1.5,
                  borderColor: r.you ? colors.accentBorderStrong : 'transparent',
                },
                r.you ? undefined : shadow.card,
              ]}
            >
              <Txt w="eb" size={16} color={medalColor(r.rank)} style={{ width: 24, textAlign: 'center' }}>
                {r.rank}
              </Txt>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: r.you ? colors.accent : colors.bg2, alignItems: 'center', justifyContent: 'center' }}>
                <Txt w="b" size={14} color={r.you ? '#fff' : colors.slate600}>
                  {r.initials}
                </Txt>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Row style={{ gap: 7 }}>
                  <Txt w="b" size={15}>
                    {r.name}
                  </Txt>
                  {r.you ? (
                    <View style={{ backgroundColor: colors.accentSurface, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
                      <Txt w="eb" size={10} color={colors.accent}>
                        YOU
                      </Txt>
                    </View>
                  ) : null}
                </Row>
                <Txt w="m" size={12} color={colors.textTertiary} style={{ marginTop: 2 }}>
                  {r.pos}
                </Txt>
              </View>
              <Txt w="eb" size={16} color={tr.c}>
                {tr.t}
              </Txt>
              <Txt w="eb" size={20} style={{ width: 34, textAlign: 'right' }}>
                {r.score}
              </Txt>
            </Row>
          );
        })}
      </View>

      <Txt w="sb" size={12} color={colors.textTertiary} style={{ marginTop: 16, textAlign: 'center' }}>
        Visible to Coach Davis · resets Sunday
      </Txt>
    </ScrollView>
  );
}

function Seg({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={{ top: 8, bottom: 8 }}
      onPress={onPress}
      style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: active ? colors.accent : 'transparent' }}
    >
      <Txt w="b" size={13} color={active ? '#fff' : colors.textSecondary}>
        {label}
      </Txt>
    </Pressable>
  );
}
