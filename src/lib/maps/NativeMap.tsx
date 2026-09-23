/* The map itself, for the place picker: AppleMaps.View on iOS, GoogleMaps.View on Android, drawing
   the same bubble (a circle overlay) and centre pin and reporting the same two events. */
import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import type { LatLng } from './geometry';
import type { mapSupport } from './mapsNative';
import type { PickerTheme } from './theme';

export type Camera = LatLng & { zoom: number };

type NativeMapProps = {
  support: Extract<ReturnType<typeof mapSupport>, { ok: true }>;
  mapRef: React.MutableRefObject<unknown>;
  camera: Camera;
  center: LatLng | null;
  radius: number;
  name: string;
  showMe: boolean;
  t: PickerTheme;
  onMapClick: (e: { coordinates: { latitude?: number; longitude?: number } }) => void;
  onCameraMove: (e: { coordinates: { latitude?: number; longitude?: number }; latitudeDelta: number; longitudeDelta: number }) => void;
};

/** AppleMaps.View on iOS, GoogleMaps.View on Android: the same bubble, pin and events on both. */
export function NativeMap({ support, mapRef, camera, center, radius, name, showMe, t, onMapClick, onCameraMove }: NativeMapProps) {
  const { AppleMaps, GoogleMaps } = support.maps;
  // cameraPosition is only the OPENING camera: expo-maps re-centres whenever this prop changes,
  // so it is memoised once and every later move goes through setCameraPosition.
  const cameraPosition = React.useMemo(
    () => ({ coordinates: { latitude: camera.lat, longitude: camera.lng }, zoom: camera.zoom }),
    [camera],
  );
  const coords = center ? { latitude: center.lat, longitude: center.lng } : null;
  // A fixed id keeps the circle the SAME map overlay as it resizes, instead of a new one per step.
  const circles = coords
    ? [{ id: 'bubble', center: coords, radius, color: t.bubbleFill, lineColor: t.bubbleEdge, lineWidth: 2.5 }]
    : [];
  const title = name.trim();

  if (Platform.OS === 'ios') {
    return (
      <AppleMaps.View
        ref={mapRef as React.Ref<never>}
        style={styles.fill}
        cameraPosition={cameraPosition}
        colorScheme={AppleMaps.MapColorScheme.AUTOMATIC}
        circles={circles}
        markers={coords ? [{ id: 'pin', coordinates: coords, systemImage: 'mappin', tintColor: t.bubbleEdge, title }] : []}
        properties={{ isMyLocationEnabled: showMe, mapType: AppleMaps.MapType.STANDARD, selectionEnabled: false }}
        uiSettings={{ compassEnabled: true, scaleBarEnabled: true, myLocationButtonEnabled: false, togglePitchEnabled: false }}
        onMapClick={onMapClick}
        onCameraMove={onCameraMove}
      />
    );
  }
  return (
    <GoogleMaps.View
      ref={mapRef as React.Ref<never>}
      style={styles.fill}
      cameraPosition={cameraPosition}
      colorScheme={GoogleMaps.MapColorScheme.FOLLOW_SYSTEM}
      circles={circles}
      markers={coords ? [{ id: 'pin', coordinates: coords, title }] : []}
      properties={{ isMyLocationEnabled: showMe }}
      uiSettings={{ compassEnabled: true, myLocationButtonEnabled: false, mapToolbarEnabled: false }}
      onMapClick={onMapClick}
      onCameraMove={onCameraMove}
    />
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
