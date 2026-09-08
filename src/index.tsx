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
    handler(event as OpenedNotification);
  });

  NativeCarillon.startObservingOpens();

  return () => {
    subscription.remove();
  };
}

/**
 * Returns SDK configuration, registration status, and queued-event count. Available in release builds.
 */
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
  debugInfo,
};

export default Carillon;
