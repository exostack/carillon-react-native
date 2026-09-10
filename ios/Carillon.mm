#import "Carillon.h"
#import <UserNotifications/UserNotifications.h>

#if __has_include(<CarillonReactNative/CarillonReactNative-Swift.h>)
#import <CarillonReactNative/CarillonReactNative-Swift.h>
#else
#import "CarillonReactNative-Swift.h"
#endif

/// The iOS half of the bridge.
///
/// It translates and forwards, and does nothing else. Registration, the retry
/// policy, the event queue, the open held across a cold start all live in the
/// Swift SDK; a behaviour that existed only here would be a behaviour that
/// SDK's own tests could never see.
@implementation Carillon {
  BOOL _observing;
}

- (void)configure:(NSString *)key endpoint:(NSString *)endpoint debug:(NSNumber *)debug
{
  [CarillonBridge configureWithKey:key endpoint:endpoint debug:[debug boolValue]];
}

- (void)requestPermission:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [CarillonBridge requestPermission:^(NSString *permission) {
    resolve(permission);
  }];
}

- (void)identify:(NSString *)externalId
{
  [CarillonBridge identify:externalId];
}

- (void)clearIdentity
{
  [CarillonBridge clearIdentity];
}

- (void)setTags:(NSDictionary *)tags
{
  [CarillonBridge setTags:tags];
}

- (void)optIn
{
  [CarillonBridge optIn];
}

- (void)optOut
{
  [CarillonBridge optOut];
}

- (void)debugInfo:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve([CarillonBridge debugInfo]);
}

- (void)startObservingOpens
{
  if (_observing) {
    return;
  }

  _observing = YES;

  // Installing the handler is what makes the SDK release the tap it has been
  // holding since launch, so this happens when JavaScript asks for it rather
  // than when this module is constructed — by which time nobody is listening.
  __weak Carillon *weakSelf = self;
  [CarillonBridge observeOpens:^(NSDictionary<NSString *, id> *opened) {
    [weakSelf emitOnOpened:opened];
  }];
}

- (void)startObservingDeviceId
{
  __weak Carillon *weakSelf = self;
  [CarillonBridge observeDeviceId:^(NSDictionary<NSString *, id> *event) {
    [weakSelf emitOnDeviceIdChanged:event];
  }];
}

- (void)clearNotifications
{
  [CarillonBridge clearNotifications];
}

- (void)startObservingReceived
{
  __weak Carillon *weakSelf = self;
  [CarillonBridge observeReceived:^(NSDictionary<NSString *, id> *event) {
    [weakSelf emitOnReceived:event];
  }];
}

- (void)stopObservingReceived
{
  [CarillonBridge stopObservingReceived];
}

- (void)finishReceived:(NSString *)requestId decision:(NSString *)decision
{
  [CarillonBridge finishReceived:requestId decision:decision];
}

- (void)invalidate
{
  [CarillonBridge stopObservingOpens];
  _observing = NO;
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeCarillonSpecJSI>(params);
}

+ (NSString *)moduleName
{
  return @"Carillon";
}

@end
