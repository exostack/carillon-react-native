import Carillon
import Foundation
import UIKit
import UserNotifications

/// The Swift half of the bridge.
///
/// The SDK's surface is pure Swift — a caseless enum with static members, which
/// Objective-C cannot see at all — so everything the TurboModule needs to say
/// is said here and re-exposed as `@objc`. Nothing is decided in this file: it
/// converts what crossed the JavaScript boundary into what the SDK takes, and
/// back.
///
/// It is also the app's own entry point for the two delegate callbacks the SDK
/// swizzles nothing to obtain. An app links this package, not the Swift SDK it
/// wraps — the SDK is resolved for this pod alone — so `import Carillon` in an
/// AppDelegate would not compile. The forwarding calls at the bottom of this
/// file are the same three, one import away:
///
/// ```swift
/// import CarillonReactNative
///
/// func application(_ app: UIApplication,
///                  didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
///   CarillonBridge.didRegister(token: token)
/// }
/// ```
@objc(CarillonBridge)
public final class CarillonBridge: NSObject {
  @objc
  public static func configure(key: String, endpoint: String?, debug: Bool) {
    // The default endpoint belongs to the SDK, which is the only place it is
    // written down. Handing its own constant back to it keeps it that way.
    Carillon.configure(key: key, endpoint: endpoint ?? Carillon.defaultEndpoint, debug: debug)
  }

  @objc
  public static func requestPermission(_ completion: @escaping (String) -> Void) {
    // `requestPermission()` is asynchronous and the JavaScript side is waiting
    // on a promise. The permission's raw value is already the word the protocol
    // uses, and the same word the Android side answers with.
    Task { completion(await Carillon.requestPermission().rawValue) }
  }

  @objc
  public static func identify(_ externalId: String) {
    Carillon.identify(externalId)
  }

  @objc
  public static func clearIdentity() {
    Carillon.clearIdentity()
  }

  @objc
  public static func setTags(_ tags: [String: Any]) {
    Carillon.setTags(tags.compactMapValues(tagValue(of:)))
  }

  @objc
  public static func optIn() {
    Carillon.optIn()
  }

  @objc
  public static func optOut() {
    Carillon.optOut()
  }

  @objc
  public static func debugInfo() -> [String: Any] {
    // The SDK's own encoding, re-read rather than rebuilt: the field names in a
    // support ticket and the field names here cannot drift apart if only one
    // side ever writes them.
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .formatted(instantFormatter)

    guard
      let data = try? encoder.encode(Carillon.debugInfo()),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      return [:]
    }

    return object
  }

  /// Installs the SDK's open handler, which is what makes it hand over the tap
  /// it has been holding since launch.
  @objc
  public static func observeOpens(_ handler: @escaping ([String: Any]) -> Void) {
    Carillon.onOpened = { opened in
      handler([
        "deliveryId": opened.deliveryId,
        "openedAt": instantFormatter.string(from: opened.openedAt),
        // The payload as APNs delivered it, untouched. The reserved `carillon`
        // key is an object here and a JSON string on Android, because that is
        // what each transport carries; `deliveryId` is above so that no app has
        // to know the difference.
        "payload": opened.userInfo,
      ])
    }
  }

  @objc
  public static func stopObservingOpens() {
    Carillon.onOpened = nil
  }

  // MARK: - The delegate callbacks the app forwards

  /// Forwarded from
  /// `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`.
  ///
  /// Takes the `Data` APNs handed over and lets the SDK hex-encode it, so the
  /// app never holds the string. Passing `token.description` instead is the
  /// single most common integration mistake there is, and this is the shape
  /// that makes it impossible.
  @objc
  public static func didRegister(token: Data) {
    Carillon.didRegister(token: token)
  }

  /// Forwarded from
  /// `application(_:didFailToRegisterForRemoteNotificationsWithError:)`.
  @objc
  public static func didFailToRegister(_ error: Error) {
    Carillon.didFailToRegister(error)
  }

  /// Forwarded from `userNotificationCenter(_:didReceive:withCompletionHandler:)`.
  ///
  /// Forward every response. A notification that is not ours carries no
  /// delivery id and is ignored, so the app does not have to work out which is
  /// which.
  @objc
  public static func didOpen(_ response: UNNotificationResponse) {
    Carillon.didOpen(response)
  }

  /// A JavaScript value, as the SDK's tag type.
  ///
  /// Anything that is not a flat scalar is dropped rather than refused: the
  /// TypeScript surface is where a tag's shape is rejected, and it is rejected
  /// there before the call is written rather than after it has shipped.
  private static func tagValue(of value: Any) -> TagValue? {
    if let text = value as? String { return .string(text) }

    guard let number = value as? NSNumber else { return nil }

    // JavaScript's booleans and numbers are both NSNumber by the time they get
    // here, and only the type id tells them apart.
    if CFGetTypeID(number) == CFBooleanGetTypeID() { return .bool(number.boolValue) }

    let value = number.doubleValue

    // A whole number arrives from JavaScript as a double and would otherwise be
    // sent as `12.0`. The SDK draws the same distinction when it restores a
    // stored map; drawing it here means a tag survives a round trip looking
    // like what the customer wrote.
    guard value == value.rounded(), value.magnitude < 9e15 else { return .double(value) }

    return .int(Int(value))
  }

  /// The instant of a tap, as JavaScript will read it — the same shape the SDK
  /// writes into a request body, spelled out again because it is internal
  /// there. A bridge may repeat a format; never a rule.
  private static let instantFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"

    return formatter
  }()
}
