// AthleteOS — full-screen overlay shell with a standard header.
import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, shadow } from '@/ui/tokens';
import { Row, Txt, Pressable } from '@/ui/primitives';
import { Icon, IconName } from '@/icons';

export function Overlay({
  title,
  onClose,
  closeIcon = 'chevronLeft',
  right,
  children,
  bg = colors.bg,
}: {
  title: string;
  onClose: () => void;
  closeIcon?: IconName;
  right?: React.ReactNode;
  children: React.ReactNode;
  bg?: string;
}) {
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: bg, zIndex: 100 }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <Row style={{ justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14 }}>
          <Pressable onPress={onClose} style={[{ width: 40, height: 40, borderRadius: 13, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, shadow.card]}>
            <Icon name={closeIcon} size={20} color={colors.slate600} />
          </Pressable>
          <Txt w="eb" size={17} ls={-0.3}>
            {title}
          </Txt>
          {right ?? <View style={{ width: 40, height: 40 }} />}
        </Row>
        {children}
      </SafeAreaView>
    </View>
  );
}
