// OnStandard — athlete "Connect your coach" overlay. Two doors to the same roster:
//  • I have a code  → resolve the code to a coach/school preview → confirm → join (active).
//  • Find my coach  → search school → pick a discoverable team → request (pending; coach
//                     approves). Live-only; offline points the athlete at the code door.
// Rides behind activation (opened from the Home card or an invite deep link), never in the
// score→first-meal spine. All backend calls are inert offline; the code door still works
// locally via connectCoach so the demo can show the flow.
import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { db, isBackendLive } from '@/lib/supabase';
import type { OrgRow, DiscoveredTeam, ResolvedTeam, FoundPractice } from '@/lib/supabase';
import { useStore } from '@/store';
import { shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Btn, Card, Input, Row, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';
import { Overlay } from './Overlay';

type Mode = 'code' | 'find';

export function Connect() {
  const c = useColors();
  const s = useStore();
  const [mode, setMode] = useState<Mode>('code');
  // code door — a code may resolve to a team (coach) OR a practice (trainer)
  const [code, setCode] = useState((s.connectPrefillCode ?? '').toUpperCase());
  const [resolved, setResolved] = useState<
    { kind: 'team'; data: ResolvedTeam } | { kind: 'practice'; data: FoundPractice } | null
  >(null);
  const [checking, setChecking] = useState(false);
  const [codeErr, setCodeErr] = useState<string | null>(null);
  // find door
  const [query, setQuery] = useState('');
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [org, setOrg] = useState<OrgRow | null>(null);
  const [teams, setTeams] = useState<DiscoveredTeam[]>([]);
  // success
  const [done, setDone] = useState<string | null>(null);

  // School search for the find door (inert offline).
  useEffect(() => {
    if (mode !== 'find' || !isBackendLive || org) return;
    let cancelled = false;
    const term = query.trim();
    if (term.length < 2) { setOrgs([]); return; }
    void db.searchOrgs(term).then((r) => { if (!cancelled) setOrgs(r); }).catch(() => { if (!cancelled) setOrgs([]); });
    return () => { cancelled = true; };
  }, [query, mode, org]);

  const checkCode = async () => {
    const v = code.trim().toUpperCase();
    if (!v) return;
    setCodeErr(null);
    if (!isBackendLive) {
      // Demo: no directory to resolve against — connect locally so the flow is visible.
      s.connectCoach(v);
      haptics.success();
      setDone('You’re connected to your coach.');
      return;
    }
    setChecking(true);
    // A code the user has could be a team (coach) OR a practice (trainer) — try both.
    const team = await db.resolveTeamCode(v).catch(() => null);
    if (team) { setResolved({ kind: 'team', data: team }); setChecking(false); return; }
    const practice = await db.resolvePracticeCode(v).catch(() => null);
    setChecking(false);
    if (practice) setResolved({ kind: 'practice', data: practice });
    else setCodeErr('We couldn’t find that code. Double-check it with your coach.');
  };

  const joinResolved = () => {
    if (!resolved) return;
    haptics.success();
    const v = code.trim().toUpperCase();
    if (resolved.kind === 'team') {
      s.connectCoach(v);
      setDone(`You’re on ${resolved.data.coach_name ? `${resolved.data.coach_name}’s` : 'the'} roster.`);
    } else {
      s.connectTrainer(v);
      setDone(`You’re connected to ${resolved.data.trainer_name ?? 'your trainer'}.`);
    }
  };

  const pickOrg = async (o: OrgRow) => {
    haptics.select();
    setOrg(o);
    setOrgs([]);
    const t = await db.discoverTeams(o.id).catch(() => []);
    setTeams(t);
  };

  const request = async (t: DiscoveredTeam) => {
    const ok = await s.requestJoinTeamLive(t.id);
    if (ok) { haptics.success(); setDone(`Request sent — ${t.coach_name ?? 'your coach'} will approve it.`); }
  };

  if (done) {
    return (
      <Overlay title="Connect" onClose={s.closeConnect} closeIcon="close">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }}>
          <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: c.successSurface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={34} color={c.successDeep} />
          </View>
          <Txt w="eb" size={20} style={{ marginTop: 18, textAlign: 'center' }}>{done}</Txt>
          <Btn label="Done" onPress={s.closeConnect} style={{ marginTop: 24, alignSelf: 'stretch' }} />
        </View>
      </Overlay>
    );
  }

  return (
    <Overlay title="Connect your coach" onClose={s.closeConnect} closeIcon="close">
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Row style={{ backgroundColor: c.bg2, borderRadius: 12, padding: 3, marginBottom: 18 }}>
          {(['code', 'find'] as Mode[]).map((m) => {
            const active = mode === m;
            const label = m === 'code' ? 'I have a code' : 'Find my coach';
            return (
              <Pressable
                key={m}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: active }}
                onPress={() => { haptics.select(); setMode(m); setResolved(null); setCodeErr(null); }}
                style={[{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: active ? c.card : 'transparent' }, active ? shadow.low : null]}
              >
                <Txt w="b" size={13} color={active ? c.accent : c.textSecondary}>{label}</Txt>
              </Pressable>
            );
          })}
        </Row>

        {mode === 'code' ? (
          <View style={{ gap: 12 }}>
            <Txt w="m" size={14} color={c.textSecondary} style={{ lineHeight: 20 }}>Enter the code your coach shared. It drops you straight onto their roster.</Txt>
            <Input value={code} onChangeText={(v) => { setCode(v.toUpperCase()); setResolved(null); setCodeErr(null); }} placeholder="Team code (e.g. EAGLES24)" autoCapitalize="characters" />
            {codeErr ? <Txt w="sb" size={13} color={c.alert}>{codeErr}</Txt> : null}
            {resolved ? (
              <Card elevated style={{ marginTop: 4 }}>
                <Txt w="eb" size={16}>{resolved.kind === 'team' ? (resolved.data.coach_name || 'Your coach') : (resolved.data.trainer_name || 'Your trainer')}</Txt>
                <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 2 }}>
                  {resolved.kind === 'team'
                    ? [resolved.data.school, resolved.data.name, resolved.data.sport].filter(Boolean).join(' · ')
                    : resolved.data.name}
                </Txt>
                <Btn label={resolved.kind === 'team' ? 'Join this team' : 'Join this practice'} haptic="success" onPress={joinResolved} style={{ marginTop: 14 }} />
              </Card>
            ) : (
              <Btn label={checking ? 'Checking…' : 'Continue'} disabled={checking || code.trim().length < 3} onPress={checkCode} />
            )}
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {!isBackendLive ? (
              <Txt w="m" size={14} color={c.textSecondary} style={{ lineHeight: 20 }}>Finding your coach by school needs you signed in. For now, use a team code above.</Txt>
            ) : !org ? (
              <>
                <Txt w="m" size={14} color={c.textSecondary} style={{ lineHeight: 20 }}>Search your school, then pick your coach to send a join request.</Txt>
                <Input value={query} onChangeText={setQuery} placeholder="Search your school" autoCapitalize="words" />
                {orgs.map((o) => (
                  <Pressable key={o.id} accessibilityRole="button" accessibilityLabel={o.name} onPress={() => pickOrg(o)} style={{ backgroundColor: c.card, borderWidth: 1.5, borderColor: c.border, borderRadius: 14, paddingVertical: 15, paddingHorizontal: 16 }}>
                    <Txt w="b" size={15}>{o.name}</Txt>
                    {[o.city, o.state].filter(Boolean).length ? <Txt w="m" size={12} color={c.textSecondary}>{[o.city, o.state].filter(Boolean).join(', ')}</Txt> : null}
                  </Pressable>
                ))}
              </>
            ) : (
              <>
                <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <Txt w="eb" size={15} style={{ flex: 1 }}>{org.name}</Txt>
                  <Pressable accessibilityRole="button" accessibilityLabel="Change school" hitSlop={6} onPress={() => { setOrg(null); setTeams([]); }}>
                    <Txt w="b" size={13} color={c.accent}>Change</Txt>
                  </Pressable>
                </Row>
                {teams.length === 0 ? (
                  <Txt w="m" size={14} color={c.textSecondary} style={{ lineHeight: 20 }}>No coaches at this school have opened up join requests yet. Ask your coach for their team code.</Txt>
                ) : teams.map((t) => (
                  <Card key={t.id} elevated>
                    <Row style={{ alignItems: 'center', gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Txt w="eb" size={15}>{t.coach_name || t.name}</Txt>
                        <Txt w="m" size={12} color={c.textSecondary}>{[t.name, t.sport].filter(Boolean).join(' · ')}</Txt>
                      </View>
                      <Btn label="Request" haptic="success" onPress={() => request(t)} />
                    </Row>
                  </Card>
                ))}
              </>
            )}
          </View>
        )}
      </ScrollView>
    </Overlay>
  );
}
