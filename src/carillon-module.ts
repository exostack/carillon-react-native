import { NativeModules } from 'react-native';

import NativeCarillon, { type Spec } from './NativeCarillon';

const expo = (globalThis as typeof globalThis & {
  expo?: { modules?: { ExpoGo?: unknown } };
}).expo;

// Expo Go exposes ExpoGo through JSI; older runtimes expose appOwnership.
const isExpoGo =
  expo?.modules?.ExpoGo != null ||
  NativeModules.ExponentConstants?.appOwnership === 'expo';

function resolveModule(): Spec {
  if (NativeCarillon) return NativeCarillon;
  if (!isExpoGo) {
    throw new Error(
      '[Carillon] Native module is missing. Complete the native setup and rebuild the app.'
    );
  }

  console.warn(
    '[Carillon] Expo Go detected: the SDK is inactive. Registration, notifications and tag updates are disabled. Use a development build to enable Carillon.'
  );

  const noop = () => {};
  const subscribe = () => ({ remove: noop });
  return {
    configure: noop,
    requestPermission: async () => 'undetermined',
    getPermission: async () => 'undetermined',
    canRequestPermission: async () => false,
    openNotificationSettings: noop,
    didOpen: noop,
    didReceive: noop,
    didRotateToken: noop,
    identify: noop,
    clearIdentity: noop,
    setTags: noop,
    setTagNumber: noop,
    setTagBoolean: noop,
    setTagDate: noop,
    removeTagNumber: noop,
    removeTagBoolean: noop,
    removeTagDate: noop,
    optIn: noop,
    optOut: noop,
    debugInfo: async () => ({ available: false, reason: 'expo_go', device_id: null }),
    startObservingOpens: noop,
    startObservingDeviceId: noop,
    startObservingReceived: noop,
    stopObservingReceived: noop,
    finishReceived: noop,
    clearNotifications: noop,
    onReceived: subscribe,
    onDeviceIdChanged: subscribe,
    onOpened: subscribe,
  };
}

export default resolveModule();
