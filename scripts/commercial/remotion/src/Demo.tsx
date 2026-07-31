import React from 'react';
import {
  AbsoluteFill, Easing, Img, Sequence, interpolate, staticFile, useCurrentFrame,
} from 'remotion';
import { C, F, sweep } from './theme';
import { Dial, Footage, Phone, Tap, Vignette, Wordmark } from './bits';
import { EndCard } from './EndCard';
import { SeqName } from './seq-manifest';

const ease = Easing.bezier(0.22, 1, 0.36, 1);
const FPS = 30;

/* ---------------- beat model ----------------
 * A beat = one feature: the phone plays a captured flow (or slow-pans a still) on the right,
 * the explanation sits in the left panel. Durations are generous on purpose — every caption
 * gets read-twice time, every scroll plays at capture speed (never sped up). */
export type Beat = {
  secs: number; title: string; body: string;
  seq?: SeqName; from?: number; rate?: number;   // sequence beats
  still?: string;                                 // still beats (slow pan)
  taps?: Tap[];                                   // fingertip ripples (beat-relative frames)
};

/* Still inside the phone shell with a slow Ken Burns pan down. */
const StillPhone: React.FC<{ src: string; height?: number }> = ({ src, height = 880 }) => {
  const frame = useCurrentFrame();
  const bezel = 13;
  const radius = height * 0.072;
  const screenH = height - bezel * 2;
  const screenW = screenH * (390 / 844);
  const pan = interpolate(frame, [0, 200], [0, -screenH * 0.16], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ transform: 'translateX(330px)', borderRadius: radius, padding: bezel,
        background: 'linear-gradient(160deg, #10141d, #05070c)', border: '1.5px solid rgba(255,255,255,0.14)',
        boxShadow: '0 60px 140px rgba(0,0,0,0.65), 0 0 110px rgba(59,130,246,0.13)' }}>
        <div style={{ width: screenW, height: screenH, borderRadius: radius - bezel + 4, overflow: 'hidden', background: '#000' }}>
          <Img src={staticFile(src)} style={{ width: '100%', transform: `translateY(${pan}px)` }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* The left explanation panel. */
const Caption: React.FC<{ eyebrow: string; title: string; body: string; index: number; count: number }> =
  ({ eyebrow, title, body, index, count }) => {
    const frame = useCurrentFrame();
    const k = interpolate(frame, [4, 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
    const k2 = interpolate(frame, [12, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
    return (
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'flex-start', paddingLeft: '6.5%' }}>
        <div style={{ width: 620 }}>
          <div style={{ fontFamily: F.body, fontWeight: 700, fontSize: 22, letterSpacing: '0.14em',
            textTransform: 'uppercase', marginBottom: 18, background: sweep(90),
            WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', opacity: k }}>
            {eyebrow}
          </div>
          <div style={{ fontFamily: F.exp, fontWeight: 900, textTransform: 'uppercase', fontSize: 60,
            lineHeight: 1.12, color: C.ink, letterSpacing: '0.01em',
            clipPath: `inset(0 0 ${(1 - k) * 100}% 0)`, transform: `translateY(${(1 - k) * 26}px)`, opacity: k }}>
            {title}
          </div>
          <div style={{ fontFamily: F.body, fontWeight: 500, fontSize: 29, lineHeight: 1.5, color: C.ink2,
            marginTop: 22, opacity: k2, transform: `translateY(${(1 - k2) * 16}px)` }}>
            {body}
          </div>
          {/* beat progress ticks */}
          <div style={{ display: 'flex', gap: 8, marginTop: 44, opacity: k2 }}>
            {Array.from({ length: count }, (_, i) => (
              <div key={i} style={{ width: i === index ? 34 : 12, height: 5, borderRadius: 3,
                background: i === index ? sweep(90) : i < index ? 'rgba(96,165,250,0.55)' : 'rgba(255,255,255,0.14)' }} />
            ))}
          </div>
        </div>
      </AbsoluteFill>
    );
  };

/* Role intro card. */
const RoleIntro: React.FC<{ role: string; line: string }> = ({ role, line }) => {
  const frame = useCurrentFrame();
  const k = interpolate(frame, [4, 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const out = interpolate(frame, [66, 78], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: C.bg, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', opacity: k * out, transform: `translateY(${(1 - k) * 24}px)` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 26 }}>
          <Dial size={124} progress={k} uid="demointro" />
          <Wordmark size={72} />
        </div>
        <div style={{ fontFamily: F.exp, fontWeight: 900, textTransform: 'uppercase', fontSize: 64, color: C.ink }}>
          For {role}
        </div>
        <div style={{ fontFamily: F.body, fontWeight: 500, fontSize: 30, color: C.ink2, marginTop: 14 }}>{line}</div>
      </div>
    </AbsoluteFill>
  );
};

/* Assemble a role demo: intro → beats → end card. */
export const demoDuration = (beats: Beat[]) => 78 + beats.reduce((a, b) => a + Math.round(b.secs * FPS), 0) + 150;

export const DemoRole: React.FC<{ role: string; line: string; beats: Beat[] }> = ({ role, line, beats }) => {
  let at = 78;
  const spans = beats.map((b) => {
    const s = { beat: b, from: at, dur: Math.round(b.secs * FPS) };
    at += s.dur;
    return s;
  });
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Sequence from={0} durationInFrames={78}><RoleIntro role={role} line={line} /></Sequence>
      {spans.map(({ beat, from, dur }, i) => (
        <Sequence key={i} from={from} durationInFrames={dur}>
          <FadeIn>
            <AbsoluteFill style={{ background: `radial-gradient(ellipse at 72% 40%, ${C.bg2}, ${C.bg} 70%)` }} />
            <Vignette strength={0.3} />
            {beat.seq ? (
              <Phone src={beat.seq} startFrom={beat.from ?? 0} playbackRate={beat.rate ?? 1}
                height={880} appear={false} punchFrom={1.0} punchTo={1.035} shiftX={330} taps={beat.taps} />
            ) : (
              <StillPhone src={beat.still!} />
            )}
            <Caption eyebrow={`OnStandard for ${role}`} title={beat.title} body={beat.body} index={i} count={beats.length} />
          </FadeIn>
        </Sequence>
      ))}
      <Sequence from={at} durationInFrames={150}><EndCard /></Sequence>
    </AbsoluteFill>
  );
};

const FadeIn: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const k = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ opacity: k }}>{children}</AbsoluteFill>;
};

/* ---------------- the four role scripts ----------------
 * Every claim below is traceable to a captured screen. Bodies are plain language,
 * ~2 lines max at 29px, written to be read comfortably inside the beat. */

export const ATHLETE_BEATS: Beat[] = [
  { seq: 'homedays', secs: 7, title: 'Your day, scored live', body: 'Meals, training, recovery — one number that moves as you log and locks at midnight.' },
  { seq: 'rollcall', secs: 7, from: 8, taps: [{ at: 79, x: 0.5, y: 0.535 }], title: 'Morning roll call', body: 'One tap says you’re up. Time-stamped at 5:02 AM, on the record, done.' },
  { seq: 'snap', secs: 8.5, from: 16, taps: [{ at: 77, x: 0.72, y: 0.9 }], title: 'Log a meal in seconds', body: 'Shoot the plate. It counts the moment you log it — the AI read lands right after.' },
  { seq: 'bfasts', secs: 7.5, title: 'The AI reads your plate', body: 'Macros, meal quality, and what to fix next time — written into your day automatically.' },
  { seq: 'threads', secs: 8, title: 'Your people see it', body: 'Coach, family and the AI reply right on the meal. One conversation, one record.' },
  { seq: 'plans', secs: 7, title: 'A plan set by your coach', body: 'Real targets — protein, calories, weight — in the style that fits how you eat.' },
  { seq: 'logsheet', secs: 5.5, from: 14, title: 'Quick logs', body: 'Water, daily commitment, check-ins. Two taps each, all of it counts.' },
  { seq: 'checkins', secs: 5.5, title: 'A weekly readiness read', body: 'Six questions, one minute. Your coach sees readiness — not your diary.' },
  { still: 'stills/cs-detail.png', secs: 6.5, title: 'Watch-verified standards', body: 'Steps sync from your phone or watch. A dead battery never counts against you.' },
  { seq: 'progresss', secs: 7, title: 'Proof over time', body: 'Weight trend, progress photos, training log, monthly report — your whole record.' },
  { seq: 'streaks', secs: 7, title: 'A streak with rules', body: '80 is the bar. One grace per week. Absent days count as misses — the number is honest.' },
  { seq: 'ring', secs: 7, from: 22, title: 'Lock the day', body: 'Hit the standard, watch it lock. Day 35 and counting.' },
];

export const COACH_BEATS: Beat[] = [
  { seq: 'coachhomes', secs: 8.5, title: 'The roster in three seconds', body: 'Who’s on standard, who’s slipping, and what needs you — already triaged when you open it.' },
  { seq: 'rosters', secs: 7, title: 'Every athlete, live', body: 'Scores, trends and last activity for the whole team — sorted by who needs attention.' },
  { seq: 'inboxs', secs: 7, title: 'A briefing, not a feed', body: 'Who hasn’t logged, who needs a response, who leads the day. Start here every morning.' },
  { seq: 'coachmeal', secs: 9, from: 100, title: 'Reply where the food is', body: 'Comment on the plate itself. The AI drafts a first pass — you edit and send.' },
  { seq: 'commitboards', secs: 5, title: 'Roll call runs itself', body: 'See who’s in at a glance. Reminders go out only when someone’s missing.' },
  { still: 'stills/cs-board.png', secs: 6, title: 'Team standards, verified', body: 'Watch-synced activity across the roster — device failures never read as misses.' },
  { seq: 'announces', secs: 6.5, title: 'Reach the right room', body: 'Whole team or position rooms — one composer, no group-chat chaos.' },
  { seq: 'insightss', secs: 8, title: 'What’s actually working', body: 'Most-missed meals, who’s trending down, this week against the month — before it costs you.' },
];

export const TRAINER_BEATS: Beat[] = [
  { seq: 'trainerhomes', secs: 8, title: 'Your book, triaged', body: 'Every client’s day — who logged, who’s overdue, who needs a nudge before it slips.' },
  { seq: 'trainerbooks', secs: 6.5, title: 'Clients, not spreadsheets', body: 'Scores and trends for everyone you coach, sorted by who needs you.' },
  { seq: 'trainerinboxs', secs: 6.5, title: 'The morning briefing', body: 'Missed logs and open questions across your whole book, in one place.' },
  { seq: 'trainermeals', secs: 8.5, title: 'Coach on the plate', body: 'Clients log meals, you reply right on them — the AI drafts, you make it yours.' },
  { seq: 'trainergrows', secs: 7, title: 'Grow your practice', body: 'A public page, offers and applications built in — your next client finds you here.' },
];

export const PARENT_BEATS: Beat[] = [
  { seq: 'parenthomes', secs: 7.5, title: 'See what matters, nothing more', body: 'Daily score, grade, and their latest day. Meal photos and check-ins stay between athlete and coach.' },
  { seq: 'threads', secs: 8, title: 'Be in their corner', body: 'Reply on a meal like anyone else backing them — right where the work happens.' },
  { seq: 'ring', secs: 6.5, from: 22, title: 'Watch the work add up', body: 'Every locked day is proof — a record they own, built one day at a time.' },
];
