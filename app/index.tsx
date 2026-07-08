import React from 'react';
import { ProtoApp } from '@/proto/ProtoApp';

// The app IS the :8124 proto now (shipped pixel-perfect in a WebView; backend wired in behind
// it phase by phase). The old React Native screens live on under src/screens for logic reuse
// (the scoring engine, the store) as we wire the backend — see docs/proto-native-app/PLAN.md.
export default function Index() {
  return <ProtoApp />;
}
