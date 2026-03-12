package com.minglelabs.mingle.rn

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule

class NativeRuntimeConfigModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "NativeRuntimeConfigModule"

  override fun getConstants(): MutableMap<String, Any> = hashMapOf(
    "runtimeConfig" to hashMapOf(
      "webAppBaseUrl" to BuildConfig.MINGLE_WEB_APP_BASE_URL,
      "defaultWsUrl" to BuildConfig.MINGLE_DEFAULT_WS_URL,
      "apiNamespace" to BuildConfig.MINGLE_API_NAMESPACE,
      "clientVersion" to BuildConfig.MINGLE_CLIENT_VERSION,
      "clientBuild" to BuildConfig.MINGLE_CLIENT_BUILD,
    ),
  )
}
