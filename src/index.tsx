import NativeCarillon from './carillon-module';

/**
 * Carillon React Native SDK. Uses the native Swift and Kotlin SDKs for
 * registration, retries, and event reporting. See the README for platform setup.
 */

/**
 * SDK configuration.
 */
export type CarillonOptions = {
  /**
 * Mobile API key from the Carillon dashboard.
 */
  key: string;
  /** API base URL. Defaults to production; override for staging or local development. */
  endpoint?: string;
  /**
 * Enables logging in iOS debug builds and debuggable Android apps only.
 */
  debug?: boolean;
};

/**
 * OS notification display permission. Android returns allowed or denied.
 * iOS also supports provisional (quiet delivery) and undetermined (not yet requested).
 */
export type PushPermission =
  'allowed' | 'denied' | 'provisional' | 'undetermined';

/**
 * Device tag value. Nested values are unsupported.
 */
export type TagValue = string;

/**
 * Opened notification with its delivery id, original payload, and tap time.
 */
export type OpenedNotification = {
  /**
 * Delivery id included in the notification by Carillon.
 */
  deliveryId: string;
  /** When the tap happened, ISO-8601. */
  openedAt: string;
  /** Everything the notification carried, the reserved `carillon` key included. */
  payload: Record<string, unknown>;
};

export type ForegroundDecision = 'show' | 'suppress';
export type ReceivedNotification = {
  deliveryId: string | null;
  title: string | null;
  body: string | null;
  data: Record<string, unknown>;
  image: string | null;
  threadId: string | null;
};

let removeReceived: (() => void) | undefined;

/** Replaces the foreground handler. Native presentation defaults to show after three seconds. */
export function onReceived(
  handler: (notification: ReceivedNotification) => ForegroundDecision | Promise<ForegroundDecision>
): () => void {
  removeReceived?.();
  const subscription = NativeCarillon.onReceived((event) => {
    const { requestId, ...notification } = event as ReceivedNotification & {
      requestId: string;
    };
    Promise.resolve()
      .then(() => handler(notification))
      .then(
        (decision) =>
          NativeCarillon.finishReceived(
            requestId,
            decision === 'suppress' ? 'suppress' : 'show',
          ),
        () => NativeCarillon.finishReceived(requestId, 'show'),
      );
  });
  const remove = () => {
    subscription.remove();
    if (removeReceived === remove) {
      removeReceived = undefined;
      NativeCarillon.stopObservingReceived();
    }
  };
  removeReceived = remove;
  NativeCarillon.startObservingReceived();
  return remove;
}

export function clearNotifications(): void {
  NativeCarillon.clearNotifications();
}

export type OpenedHandler = (notification: OpenedNotification) => void;

/**
 * Native diagnostic fields, including the mobile key, device token, and registration status.
 */
export type DebugInfo = Record<string, unknown>;

/**
 * Starts device registration without a permission prompt. Call once at app startup.
 * Registration requires a push token and network access.
 */
export function configure(options: CarillonOptions): void {
  NativeCarillon.configure(options.key, options.endpoint, options.debug);
}

/**
 * Requests notification permission and returns the current OS status.
 * Syncs the result to the server. On Android, the bridge supplies the activity.
 */
export async function requestPermission(): Promise<PushPermission> {
  return (await NativeCarillon.requestPermission()) as PushPermission;
}

/**
 * Reads the current OS permission without showing a prompt and syncs it to the server.
 */
export async function getPermission(): Promise<PushPermission> {
  return (await NativeCarillon.getPermission()) as PushPermission;
}

/**
 * Whether requestPermission would show the system prompt. When false, openNotificationSettings
 * is the only way for the person to change their answer.
 */
export function canRequestPermission(): Promise<boolean> {
  return NativeCarillon.canRequestPermission();
}

/**
 * Opens the app's notification settings screen.
 */
export function openNotificationSettings(): void {
  NativeCarillon.openNotificationSettings();
}

/**
 * Forwards a tapped notification's payload when another library owns the native callbacks.
 * Payloads without a Carillon delivery id are ignored.
 */
export function didOpen(payload: Record<string, unknown>): void {
  NativeCarillon.didOpen(payload);
}

/**
 * Forwards a received message's data when another library owns the Android messaging service.
 * Does nothing on iOS, where presentation is decided in the notification-center delegate.
 */
export function didReceive(payload: Record<string, unknown>): void {
  NativeCarillon.didReceive(payload);
}

/**
 * Forwards a rotated FCM token when another library owns the Android messaging service.
 * Does nothing on iOS, where the token arrives through the app delegate.
 */
export function didRotateToken(token: string): void {
  NativeCarillon.didRotateToken(token);
}

/**
 * Sets the external user id. Pass null to clear it without opting out.
 */
export function identify(externalId: string | null): void {
  if (externalId === null) {
    NativeCarillon.clearIdentity();

    return;
  }

  NativeCarillon.identify(externalId);
}

/**
 * Merges supplied tags. Null removes a key; omitted keys are unchanged.
 */
export function setTags(tags: Record<string, TagValue | null>): void {
  for (const value of Object.values(tags)) {
    if (value !== null && typeof value !== 'string')
      throw new TypeError(
        'Use setTagNumber or setTagBoolean for non-text tags',
      );
  }
  NativeCarillon.setTags(tags);
}

export function setTag(name: string, value: TagValue): void {
  setTags({ [name]: value });
}

export function setTagNumber(name: string, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new TypeError('Tag numbers must be finite');
  NativeCarillon.setTagNumber(name, value);
}
export function setTagBoolean(name: string, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('Expected a boolean');
  NativeCarillon.setTagBoolean(name, value);
}
export function setTagDate(name: string, value: Date): void {
  if (
    !(value instanceof Date) ||
    !Number.isFinite(value.getTime()) ||
    value.getUTCFullYear() < 1 ||
    value.getUTCFullYear() > 9999
  )
    throw new TypeError('Expected a valid Date');
  NativeCarillon.setTagDate(name, value.getTime());
}
export function removeTagNumber(name: string): void {
  NativeCarillon.removeTagNumber(name);
}
export function removeTagBoolean(name: string): void {
  NativeCarillon.removeTagBoolean(name);
}
export function removeTagDate(name: string): void {
  NativeCarillon.removeTagDate(name);
}

export function removeTag(name: string): void {
  setTags({ [name]: null });
}

/**
 * Sets opted_in to true and syncs it to the server. Does not change OS permission.
 */
export function optIn(): void {
  NativeCarillon.optIn();
}

/**
 * Sets opted_in to false and syncs it to the server. Keeps the device registered.
 */
export function optOut(): void {
  NativeCarillon.optOut();
}

/**
 * Subscribes to notification opens and returns an unsubscribe function.
 * Pending cold-start opens are replayed when the first subscriber attaches.
 * The listener must attach before startObservingOpens triggers that replay.
 */
export function onOpened(handler: OpenedHandler): () => void {
  const subscription = NativeCarillon.onOpened((event) => {
    const notification = event as OpenedNotification;
    const stamp = notification.payload.carillon;
    if (typeof stamp === 'string') {
      try {
        const parsed: unknown = JSON.parse(stamp);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          handler({ ...notification, payload: { ...notification.payload, carillon: parsed } });
          return;
        }
      } catch {
        // Keep malformed third-party payloads observable without losing the open callback.
      }
    }
    handler(notification);
  });

  NativeCarillon.startObservingOpens();

  return () => {
    subscription.remove();
  };
}

/**
 * Returns the registered device id, or null before registration succeeds.
 */
export async function getDeviceId(): Promise<string | null> {
  const info = (await NativeCarillon.debugInfo()) as Record<string, unknown>;
  return typeof info.device_id === 'string' ? info.device_id : null;
}

/**
 * Subscribes to device id changes. A known id is replayed to a new subscriber.
 */
export function onDeviceIdChanged(handler: (id: string) => void): () => void {
  const subscription = NativeCarillon.onDeviceIdChanged((event) => {
    const payload = event as Record<string, unknown>;
    if (typeof payload.deviceId === 'string') handler(payload.deviceId);
  });
  NativeCarillon.startObservingDeviceId();
  return () => subscription.remove();
}

export async function debugInfo(): Promise<DebugInfo> {
  return (await NativeCarillon.debugInfo()) as DebugInfo;
}

const Carillon = {
  configure,
  requestPermission,
  getPermission,
  canRequestPermission,
  openNotificationSettings,
  didOpen,
  didReceive,
  didRotateToken,
  identify,
  setTags,
  setTag,
  setTagNumber,
  setTagBoolean,
  setTagDate,
  removeTagNumber,
  removeTagBoolean,
  removeTagDate,
  removeTag,
  optIn,
  optOut,
  onOpened,
  onReceived,
  clearNotifications,
  debugInfo,
  getDeviceId,
  onDeviceIdChanged,
};

export default Carillon;
