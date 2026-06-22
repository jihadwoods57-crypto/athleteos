// AthleteOS — in-app notification inbox (NEW / EARLIER).
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useStore, useDerived } from '@/store';
import { colors, shadow } from '@/ui/tokens';
import { Row, Txt, Pressable } from '@/ui/primitives';
import { Icon, IconName } from '@/icons';
import { Overlay } from './Overlay';

export function Notifications() {
  const s = useStore();
  const d = useDerived();

  const go = (fn: () => void) => () => {
    s.closeNotif();
    fn();
  };

  return (
    <Overlay title="Notifications" onClose={s.closeNotif} right={<Pressable onPress={s.closeNotif}><Txt w="b" size={13} color={colors.accent}>Clear</Txt></Pressable>}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <SectionLabel>NEW</SectionLabel>
        <View style={{ gap: 10 }}>
          <NotifCard icon="checkin" accent={colors.accent} title="Weekly check-in due" time="2m" text="Takes 2 minutes. Your coach and parent are waiting on it." onPress={go(s.goCheckin)} />
          <NotifCard icon="camera" accent={colors.accent} title="Time to log dinner" time="18m" text={`You're ${d.proteinGap}g of protein from your target — one more meal does it.`} onPress={go(s.openMeal)} />
          <NotifCard icon="trophy" accent={colors.success} iconBg={colors.successSurface} iconColor={colors.successDeep} title="Score update" time="1h" text={`Your Athlete Score is ${d.athleteScore} — you're #2 in the linebacker room.`} onPress={go(s.goSquad)} />
        </View>

        <SectionLabel style={{ marginTop: 20 }}>EARLIER</SectionLabel>
        <View style={{ gap: 10 }}>
          <NotifCard initials="CD" title="Coach Davis" time="4h" text={'"Strong week — your nutrition is the best in the room. Keep it up."'} />
          <NotifCard icon="drop" accent={colors.hydration} iconColor={colors.hydration} title="Hydration reminder" time="6h" text="You're behind on water. Knock out 500ml before practice." />
        </View>
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
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[
        { flexDirection: 'row', gap: 13, backgroundColor: '#fff', borderRadius: 16, padding: 15, borderLeftWidth: accent && onPress ? 3 : 0, borderLeftColor: accent },
        shadow.card,
      ]}
    >
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: initials ? colors.text : iconBg ?? colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
        {initials ? <Txt w="b" size={13} color="#fff">{initials}</Txt> : <Icon name={icon!} size={19} color={iconColor ?? colors.accent} />}
      </View>
      <View style={{ flex: 1 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt w="b" size={14}>
            {title}
          </Txt>
          <Txt w="sb" size={11} color={colors.textTertiary}>
            {time}
          </Txt>
        </Row>
        <Txt w="m" size={13} color={colors.textSecondary} style={{ marginTop: 2, lineHeight: 18 }}>
          {text}
        </Txt>
      </View>
    </Pressable>
  );
}
