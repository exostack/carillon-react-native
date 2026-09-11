import Carillon
import Foundation
import UIKit
import UserNotifications

/// Exposes the Swift SDK to Objective-C and the React Native TurboModule.
/// Apps import CarillonReactNative and forward APNs registration and open
/// callbacks through this class. See the README for delegate setup.
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
  public static func getPermission(_ completion: @escaping (String) -> Void) {
    Task { completion(await Carillon.getPermission().rawValue) }
  }

  @objc
  public static func canRequestPermission(_ completion: @escaping (Bool) -> Void) {
    Task { completion(await Carillon.canRequestPermission()) }
  }

  @objc
  public static func openNotificationSettings() {
    Carillon.openNotificationSettings()
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

  /// Installs the native open handler and replays buffered opens.
  @objc
  public static func observeOpens(_ handler: @escaping ([String: Any]) -> Void) {
    Carillon.onOpened = { opened in
      handler([
        "deliveryId": opened.deliveryId,
        "openedAt": instantFormatter.string(from: opened.openedAt),
        // The payload as APNs delivered it, untouched. The reserved `carillon`
        // key is already an object here; on Android it arrives as a JSON string
        // and the JavaScript layer parses it, so both platforms deliver the same shape.
        "payload": opened.userInfo,
      ])
    }
  }

  @objc
  public static func observeDeviceId(_ handler: @escaping ([String: Any]) -> Void) {
    Carillon.onDeviceIdChanged = { handler(["deviceId": $0]) }
  }

  @objc
  public static func stopObservingOpens() {
    stopObservingReceived()
    Carillon.onOpened = nil
    Carillon.onDeviceIdChanged = nil
  }

  private static let receivedLock = NSLock()
  private static var receivedHandler: (([String: Any]) -> Void)?
  private static var receivedAnswers: [String: (UNNotificationPresentationOptions) -> Void] = [:]

  @objc public static func observeReceived(_ handler: @escaping ([String: Any]) -> Void) {
    receivedLock.lock()
    receivedHandler = handler
    receivedLock.unlock()
  }

  @objc public static func finishReceived(_ requestId: String, decision: String) {
    receivedLock.lock()
    let completion = receivedAnswers.removeValue(forKey: requestId)
    receivedLock.unlock()
    completion?(decision == "suppress" ? [] : [.banner, .list, .sound, .badge])
  }

  @objc public static func stopObservingReceived() {
    receivedLock.lock()
    receivedHandler = nil
    let pending = Array(receivedAnswers.values)
    receivedAnswers.removeAll()
    receivedLock.unlock()
    for completion in pending { completion([.banner, .list, .sound, .badge]) }
  }

  @objc public static func clearNotifications() { Carillon.clearNotifications() }

  @objc public static func willPresent(
    _ notification: UNNotification,
    completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    receivedLock.lock()
    guard let handler = receivedHandler else {
      receivedLock.unlock()
      completionHandler([.banner, .list, .sound, .badge])
      return
    }
    let id = UUID().uuidString
    receivedAnswers[id] = completionHandler
    receivedLock.unlock()
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { finishReceived(id, decision: "show") }
    let content = notification.request.content
    let received = ReceivedNotification(userInfo: content.userInfo, title: content.title, body: content.body)
    handler([
      "requestId": id,
      "deliveryId": received.deliveryId as Any? ?? NSNull(),
      "title": received.title as Any? ?? NSNull(),
      "body": received.body as Any? ?? NSNull(),
      "data": received.data,
      "image": received.image as Any? ?? NSNull(),
      "threadId": received.threadId as Any? ?? NSNull(),
    ])
  }

  // MARK: - The delegate callbacks the app forwards

  /// Forward application(_:didRegisterForRemoteNotificationsWithDeviceToken:).
  /// Pass the original APNs Data token; the SDK hex-encodes it.
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

  /// Forward userNotificationCenter(_:didReceive:withCompletionHandler:).
  /// Notifications without a Carillon delivery id are ignored.
  @objc
  public static func didOpen(_ response: UNNotificationResponse) {
    Carillon.didOpen(response)
  }

  /// Forward an opened payload from a delegate that belongs to another library.
  @objc
  public static func didOpen(userInfo: [AnyHashable: Any]) {
    Carillon.didOpen(userInfo: userInfo)
  }

  /// Converts scalar JavaScript tag values. Unsupported values are omitted.
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

  /// UTC timestamp format exposed to JavaScript, including milliseconds.
  private static let instantFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"

    return formatter
  }()
}
