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
import { Icon, IconName } from '@/icons';
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
  // join-request in flight / failure (a request that silently no-ops strands the athlete waiting
  // for an approval that never comes — so it must show progress and surface a failure).
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [reqErr, setReqErr] = useState<string | null>(null);

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

  const joinResolved = async () => {
    if (!resolved || checking) return;
    const v = code.trim().toUpperCase();
    setCodeErr(null);
    setChecking(true);
    // The join must actually land before the success screen: "You're on the roster"
    // over a failed RPC strands the athlete waiting for a coach who never saw them.
    const ok = resolved.kind === 'team' ? await s.joinTeamLive(v) : await s.joinPracticeLive(v);
    setChecking(false);
    if (!ok) {
      haptics.tap();
      setCodeErr("The join didn't go through. Check your connection and try again.");
      return;
    }
    haptics.success();
    setDone(
      resolved.kind === 'team'
        ? `You’re on ${resolved.data.coach_name ? `${resolved.data.coach_name}’s` : 'the'} roster.`
        : `You’re connected to ${resolved.data.trainer_name ?? 'your trainer'}.`,
    );
  };

  const pickOrg = async (o: OrgRow) => {
    haptics.select();
    setOrg(o);
    setOrgs([]);
    const t = await db.discoverTeams(o.id).catch(() => []);
    setTeams(t);
  };

  const request = async (t: DiscoveredTeam) => {
    setReqErr(null);
    setRequestingId(t.id);
    try {
      const ok = await s.requestJoinTeamLive(t.id);
      if (ok) { haptics.success(); setDone(`Request sent — ${t.coach_name ?? 'your coach'} will approve it.`); }
      else setReqErr('We couldn’t send that request. Check your connection and try again.');
    } catch {
      setReqErr('We couldn’t send that request. Check your connection and try again.');
    } finally {
      setRequestingId(null);
    }
  };

  if (done) {
    return (
      <Overlay title="Connect" onClose={s.closeConnect} closeIcon="close">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }}>
          <View style={{ width: 84, height: 84, borderRadius: 28, backgroundColor: c.successSurface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.successBorderSoft }}>
            <Icon name="check" size={38} color={c.successDeep} />
          </View>
          <Txt w="eb" size={11} color={c.successDeep} ls={0.7} style={{ marginTop: 22 }}>CONNECTED</Txt>
          <Txt w="eb" size={21} ls={-0.4} style={{ marginTop: 8, textAlign: 'center', lineHeight: 28 }}>{done}</Txt>
          <Btn label="Done" onPress={s.closeConnect} style={{ marginTop: 26, alignSelf: 'stretch' }} />
        </View>
      </Overlay>
    );
  }

  return (
    <Overlay title="Connect your coach" onClose={s.closeConnect} closeIcon="close">
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* Two doors to the same roster — a premium segmented switch (surface2 + hairline,
            the app's selector idiom; active seg lifts on the accent with the CTA glow). */}
        <Row style={{ backgroundColor: c.surface2, borderRadius: 14, padding: 4, marginBottom: 20, borderWidth: 1, borderColor: c.hairline }}>
          {(['code', 'find'] as Mode[]).map((m) => {
            const active = mode === m;
            const label = m === 'code' ? 'I have a code' : 'Find my coach';
            return (
              <Pressable
                key={m}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: active }}
                hitSlop={{ top: 8, bottom: 8 }}
                onPress={() => { haptics.select(); setMode(m); setResolved(null); setCodeErr(null); }}
                style={[{ flex: 1, paddingVertical: 11, borderRadius: 11, alignItems: 'center', backgroundColor: active ? c.accent : 'transparent' }, active ? shadow.cta : null]}
              >
                <Txt w="b" size={13} color={active ? c.white : c.textSecondary}>{label}</Txt>
              </Pressable>
            );
          })}
        </Row>

        {mode === 'code' ? (
          <View style={{ gap: 14 }}>
            {/* Premium code-entry card: eyebrow, the clean dark field, then the confirm/preview. */}
            <Card variant="low" style={{ borderRadius: 22, padding: 20 }}>
              <Row style={{ gap: 11, marginBottom: 12 }}>
                <IconTile name="shield" />
                <View style={{ flex: 1 }}>
                  <Eyebrow>TEAM CODE</Eyebrow>
                  <Txt w="m" size={13.5} color={c.textSecondary} style={{ marginTop: 4, lineHeight: 19 }}>Enter the code your coach shared. It drops you straight onto their roster.</Txt>
                </View>
              </Row>
              <Field
                icon="bolt"
                value={code}
                onChangeText={(v) => { setCode(v.toUpperCase()); setResolved(null); setCodeErr(null); }}
                placeholder="Team code (e.g. EAGLES24)"
                autoCapitalize="characters"
                autoCorrect={false}
                accessibilityLabel="Team code"
              />
              {codeErr ? <ErrLine text={codeErr} /> : null}
              {resolved ? (
                // Resolved preview: a framed accent-surface confirmation with an avatar tile.
                <View style={{ marginTop: 14, borderRadius: 16, padding: 15, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder }}>
                  <Row style={{ gap: 12, alignItems: 'center' }}>
                    <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={resolved.kind === 'team' ? 'squad' : 'bolt'} size={20} color={c.white} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt w="eb" size={16} ls={-0.2} numberOfLines={1}>{resolved.kind === 'team' ? (resolved.data.coach_name || 'Your coach') : (resolved.data.trainer_name || 'Your trainer')}</Txt>
                      <Txt w="m" size={12.5} color={c.textSecondary} style={{ marginTop: 2 }} numberOfLines={2}>
                        {resolved.kind === 'team'
                          ? [resolved.data.school, resolved.data.name, resolved.data.sport].filter(Boolean).join(' · ')
                          : resolved.data.name}
                      </Txt>
                    </View>
                  </Row>
                  {/* Outcome haptics live in joinResolved — a success buzz on press would
                      celebrate a join that may be about to fail. */}
                  <Btn label={checking ? 'Joining…' : resolved.kind === 'team' ? 'Join this team' : 'Join this practice'} haptic="none" disabled={checking} onPress={() => void joinResolved()} style={{ marginTop: 14 }} />
                </View>
              ) : (
                <Btn label={checking ? 'Checking…' : 'Continue'} disabled={checking || code.trim().length < 3} onPress={checkCode} style={{ marginTop: 14 }} />
              )}
            </Card>
          </View>
        ) : (
          <View style={{ gap: 14 }}>
            {!isBackendLive ? (
              <Card variant="low" style={{ borderRadius: 22, padding: 20 }}>
                <Row style={{ gap: 11 }}>
                  <IconTile name="search" />
                  <View style={{ flex: 1 }}>
                    <Eyebrow>FIND MY COACH</Eyebrow>
                    <Txt w="m" size={13.5} color={c.textSecondary} style={{ marginTop: 4, lineHeight: 20 }}>Finding your coach by school needs you signed in. For now, use a team code above.</Txt>
                  </View>
                </Row>
              </Card>
            ) : !org ? (
              <Card variant="low" style={{ borderRadius: 22, padding: 20 }}>
                <Row style={{ gap: 11, marginBottom: 12 }}>
                  <IconTile name="search" />
                  <View style={{ flex: 1 }}>
                    <Eyebrow>FIND BY SCHOOL</Eyebrow>
                    <Txt w="m" size={13.5} color={c.textSecondary} style={{ marginTop: 4, lineHeight: 19 }}>Search your school, then pick your coach to send a join request.</Txt>
                  </View>
                </Row>
                <Field
                  icon="search"
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search your school"
                  autoCapitalize="words"
                  accessibilityLabel="Search your school"
                />
                {orgs.length > 0 ? (
                  <View style={{ marginTop: 12, gap: 9 }}>
                    {orgs.map((o) => (
                      <Pressable key={o.id} accessibilityRole="button" accessibilityLabel={o.name} onPress={() => pickOrg(o)} style={({ pressed }) => ({ backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 11, opacity: pressed ? 0.75 : 1 })}>
                        <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="shield" size={16} color={c.accent} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Txt w="b" size={15} numberOfLines={1}>{o.name}</Txt>
                          {[o.city, o.state].filter(Boolean).length ? <Txt w="m" size={12} color={c.textSecondary} style={{ marginTop: 1 }}>{[o.city, o.state].filter(Boolean).join(', ')}</Txt> : null}
                        </View>
                        <Icon name="chevronRight" size={18} color={c.slate300} />
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </Card>
            ) : (
              <Card variant="low" style={{ borderRadius: 22, padding: 20 }}>
                <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Row style={{ gap: 11, flex: 1, minWidth: 0 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="shield" size={17} color={c.accent} />
                    </View>
                    <Txt w="eb" size={15} ls={-0.2} style={{ flex: 1 }} numberOfLines={1}>{org.name}</Txt>
                  </Row>
                  <Pressable accessibilityRole="button" accessibilityLabel="Change school" hitSlop={6} onPress={() => { setOrg(null); setTeams([]); }} style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9, backgroundColor: c.surface2, opacity: pressed ? 0.7 : 1 })}>
                    <Txt w="b" size={12.5} color={c.accent}>Change</Txt>
                  </Pressable>
                </Row>
                {teams.length === 0 ? (
                  <Txt w="m" size={13.5} color={c.textSecondary} style={{ marginTop: 12, lineHeight: 20 }}>No coaches at this school have opened up join requests yet. Ask your coach for their team code.</Txt>
                ) : (
                  <View style={{ marginTop: 14, gap: 10 }}>
                    {teams.map((t) => (
                      <View key={t.id} style={{ borderRadius: 16, padding: 14, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline }}>
                        <Row style={{ alignItems: 'center', gap: 11 }}>
                          <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="squad" size={19} color={c.accent} />
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Txt w="eb" size={15} ls={-0.2} numberOfLines={1}>{t.coach_name || t.name}</Txt>
                            <Txt w="m" size={12} color={c.textSecondary} style={{ marginTop: 1 }} numberOfLines={1}>{[t.name, t.sport].filter(Boolean).join(' · ')}</Txt>
                          </View>
                          <Btn
                            label={requestingId === t.id ? 'Sending…' : 'Request'}
                            disabled={requestingId !== null}
                            haptic="success"
                            onPress={() => request(t)}
                            style={{ height: 44, paddingHorizontal: 18, borderRadius: 13 }}
                          />
                        </Row>
                      </View>
                    ))}
                  </View>
                )}
                {reqErr ? <ErrLine text={reqErr} /> : null}
              </Card>
            )}
          </View>
        )}
      </ScrollView>
    </Overlay>
  );
}

/** Small-caps section label — the app's eyebrow idiom (Home/Profile). Presentation only. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return <Txt w="eb" size={11.5} color={c.accent} ls={0.6}>{children}</Txt>;
}

/** Rounded accent-surface icon tile that leads a section — the app's premium row idiom. */
function IconTile({ name }: { name: IconName }) {
  const c = useColors();
  return (
    <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={19} color={c.accent} />
    </View>
  );
}

/** Clean dark input field: a surface2 + hairline shell with a leading muted icon, so the
 *  text field reads as an edge on the dark canvas (not the default floating white card).
 *  Presentation wrapper around the same TextInput props the callers already pass. */
function Field({ icon, accessibilityLabel, ...props }: React.ComponentProps<typeof Input> & { icon: IconName }) {
  const c = useColors();
  return (
    <Row style={{ backgroundColor: c.surface2, borderRadius: 14, borderWidth: 1, borderColor: c.hairline, paddingLeft: 14, height: 54 }}>
      <Icon name={icon} size={17} color={c.textTertiary} />
      <Input
        {...props}
        accessibilityLabel={accessibilityLabel}
        style={[{ flex: 1, height: 52, backgroundColor: 'transparent', paddingHorizontal: 12, shadowOpacity: 0, elevation: 0 }, props.style]}
      />
    </Row>
  );
}

/** Inline error line with a small alert dot — honest failure copy, unchanged text. */
function ErrLine({ text }: { text: string }) {
  const c = useColors();
  return (
    <Row style={{ gap: 8, alignItems: 'center', marginTop: 12 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.alert }} />
      <Txt w="sb" size={13} color={c.alert} style={{ flex: 1, lineHeight: 18 }}>{text}</Txt>
    </Row>
  );
}
