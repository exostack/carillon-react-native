#import <CarillonSpec/CarillonSpec.h>
#import <React/RCTInvalidating.h>

/// The class JavaScript reaches. Named after the module because that is how
/// React Native finds it: `NSClassFromString(@"Carillon")`, and nothing else.
@interface Carillon : NativeCarillonSpecBase <NativeCarillonSpec, RCTInvalidating>

@end
