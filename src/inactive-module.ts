import type { Spec } from './NativeCarillon';

export function inactiveModule(reason: string): Spec {
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
    debugInfo: async () => ({ available: false, reason, device_id: null }),
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
