import { NativeModules } from 'react-native';

import { inactiveModule } from './inactive-module';
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
  console.warn(
    isExpoGo
      ? '[Carillon] Expo Go detected: the SDK is inactive. Use a development build to enable Carillon.'
      : '[Carillon] Native module is missing: the SDK is inactive. Rebuild the app with Carillon and use a matching Expo runtime version.'
  );

  return inactiveModule(isExpoGo ? 'expo_go' : 'native_module_missing');
}

export default resolveModule();

export const available = NativeCarillon != null;
