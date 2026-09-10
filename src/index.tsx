import NativeCarillon from './NativeCarillon';

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
  | 'allowed'
  | 'denied'
  | 'provisional'
  | 'undetermined';

/**
 * Device tag value. Nested values are unsupported.
 */
export type TagValue = string | number | boolean;

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
    const { requestId, ...notification } = event as ReceivedNotification & { requestId: string };
    Promise.resolve().then(() => handler(notification)).then(
      (decision) => NativeCarillon.finishReceived(requestId, decision === 'suppress' ? 'suppress' : 'show'),
      () => NativeCarillon.finishReceived(requestId, 'show')
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
 * Replaces all device tags. Omitted tags are removed.
 */
export function setTags(tags: Record<string, TagValue>): void {
  NativeCarillon.setTags(tags);
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
  identify,
  setTags,
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
