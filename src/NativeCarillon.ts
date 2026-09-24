import {
  TurboModuleRegistry,
  type CodegenTypes,
  type TurboModule,
} from 'react-native';

/**
 * Native codegen interface. The JavaScript wrapper maps options to scalar arguments.
 */
export interface Spec extends TurboModule {
  configure(key: string, endpoint?: string, debug?: boolean): void;

  /**
 * Returns allowed, denied, provisional, or undetermined.
 * The Android module supplies the activity for the permission request.
 */
  requestPermission(): Promise<string>;

  /** Reads the permission without prompting. Same words as requestPermission. */
  getPermission(): Promise<string>;
  canRequestPermission(): Promise<boolean>;
  openNotificationSettings(): void;

  /**
 * Forwards from an app whose native callbacks belong to another library.
 * didReceive and didRotateToken do nothing on iOS.
 */
  didOpen(payload: CodegenTypes.UnsafeObject): void;
  didReceive(payload: CodegenTypes.UnsafeObject): void;
  didRotateToken(token: string): void;

  identify(externalId: string): void;
  clearIdentity(): void;
  setTags(tags: CodegenTypes.UnsafeObject): void;
  setTagNumber(name: string, value: number): void;
  setTagBoolean(name: string, value: boolean): void;
  setTagDate(name: string, milliseconds: number): void;
  removeTagNumber(name: string): void;
  removeTagBoolean(name: string): void;
  removeTagDate(name: string): void;
  optIn(): void;
  optOut(): void;

  /**
 * Native diagnostic fields.
 */
  debugInfo(): Promise<CodegenTypes.UnsafeObject>;

  /**
 * Installs the native handler and replays buffered opens.
 * Attach the JavaScript listener first to avoid losing cold-start events. Idempotent.
 */
  startObservingOpens(): void;
  startObservingDeviceId(): void;
  startObservingReceived(): void;
  stopObservingReceived(): void;
  finishReceived(requestId: string, decision: string): void;
  clearNotifications(): void;
  readonly onReceived: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
  readonly onDeviceIdChanged: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;

  /**
 * OpenedNotification payload. UnsafeObject allows application-defined payload keys.
 */
  readonly onOpened: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Carillon');
