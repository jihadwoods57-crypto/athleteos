// OnStandard — in-app notification inbox (NEW / EARLIER).
import React from 'react';
import { ScrollView, View } from 'react-native';
import { notificationCopy } from '@/core';
import { useStore, useDerived } from '@/store';
import { colors, shadow } from '@/ui/tokens';
import { PressScale, Reveal, Row, Txt, Pressable } from '@/ui/primitives';
import { Icon, IconName } from '@/icons';
import { Overlay } from './Overlay';

export function Notifications() {
  const s = useStore();
  const d = useDerived();

  const go = (fn: () => void) => () => {
    s.closeNotif();
    fn();
  };

  // Gate the inbox copy so a real athlete is never told a coach, parent, or
  // position room they don't have is waiting on / ranking / praising them. The
  // seeded demo keeps the exact showcase strings.
  const copy = notificationCopy({
    isReal: s.athleteName.trim().length > 0,
    supportTeam: s.supportTeam,
    athleteScore: d.athleteScore,
  });

  return (
    <Overlay title="Notifications" onClose={s.closeNotif} right={<Pressable accessibilityRole="button" accessibilityLabel="Clear notifications" hitSlop={8} onPress={s.closeNotif}><Txt w="b" size={13} color={colors.accent}>Clear</Txt></Pressable>}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <SectionLabel>NEW</SectionLabel>
        <Reveal index={0}>
        <View style={{ gap: 10 }}>
          <NotifCard icon="checkin" accent={colors.accent} title="Weekly check-in due" time="2m" text={copy.checkin} onPress={go(s.goCheckin)} />
          <NotifCard icon="camera" accent={colors.accent} title="Time to log dinner" time="18m" text={`You're ${d.proteinGap}g of protein from your target. One more meal does it.`} onPress={go(s.openMeal)} />
          <NotifCard icon="trophy" accent={colors.success} iconBg={colors.successSurface} iconColor={colors.successDeep} title="Score update" time="1h" text={copy.score} onPress={go(s.goSquad)} />
        </View>
        </Reveal>

        <SectionLabel style={{ marginTop: 20 }}>EARLIER</SectionLabel>
        <Reveal index={1}>
        <View style={{ gap: 10 }}>
          {copy.coachNote ? (
            <NotifCard initials={copy.coachNote.initials} title={copy.coachNote.title} time="4h" text={copy.coachNote.text} />
          ) : null}
          <NotifCard icon="drop" accent={colors.hydration} iconColor={colors.hydration} title="Hydration reminder" time="6h" text="You're behind on water. Knock out 500ml before practice." />
        </View>
        </Reveal>
      </ScrollView>
    </Overlay>
  );
}

function SectionLabel({ children, style }: { children: React.ReactNode; style?: any }) {
  return (
    <Txt w="eb" size={12} color={colors.textTertiary} ls={0.7} style={[{ marginVertical: 10, marginLeft: 4 }, style]}>
      {children}
    </Txt>
  );
}

function NotifCard({ icon, initials, accent, iconBg, iconColor, title, time, text, onPress }: { icon?: IconName; initials?: string; accent?: string; iconBg?: string; iconColor?: string; title: string; time: string; text: string; onPress?: () => void }) {
  const boxStyle = { flexDirection: 'row' as const, gap: 13, backgroundColor: '#fff', borderRadius: 16, padding: 15, borderLeftWidth: accent && onPress ? 3 : 0, borderLeftColor: accent };
  const body = (
    <>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: initials ? colors.text : iconBg ?? colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
        {initials ? <Txt w="b" size={13} color="#fff">{initials}</Txt> : <Icon name={icon!} size={19} color={iconColor ?? colors.accent} />}
      </View>
      <View style={{ flex: 1 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt w="b" size={14}>
            {title}
          </Txt>
          <Txt w="sb" num size={11} color={colors.textTertiary}>
            {time}
          </Txt>
        </Row>
        <Txt w="m" size={13} color={colors.textSecondary} style={{ marginTop: 2, lineHeight: 18 }}>
          {text}
        </Txt>
      </View>
    </>
  );
  // Tappable rows get the press-scale feel; the passive (no-onPress) reminders stay a flat card.
  return onPress ? (
    <PressScale accessibilityLabel={title} onPress={onPress} style={[boxStyle, shadow.card]}>
      {body}
    </PressScale>
  ) : (
    <View style={[boxStyle, shadow.card]}>{body}</View>
  );
}
