#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(NativeAuthModule, NSObject)

RCT_EXTERN_METHOD(startSession:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
