package com.rrwr.app

import android.content.pm.ActivityInfo
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    WebView.setWebContentsDebuggingEnabled(true)
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
    webView.addJavascriptInterface(AndroidBridge(), "RRWRAndroidNative")
  }

  inner class AndroidBridge {
    @JavascriptInterface
    fun setFullscreenLandscape(enabled: Boolean) {
      setAssetFullscreen(enabled, enabled)
    }

    @JavascriptInterface
    fun setAssetFullscreen(enabled: Boolean, preferLandscape: Boolean) {
      runOnUiThread {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        if (enabled) {
          requestedOrientation = if (preferLandscape) {
            ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
          } else {
            ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
          }
          controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
          controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
          requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
          controller.show(WindowInsetsCompat.Type.systemBars())
        }
      }
    }
  }
}
