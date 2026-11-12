package com.rpmdelivery.courier

import android.os.Bundle
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.ViewModelProvider
import com.rpmdelivery.courier.auth.CourierAuthViewModel
import com.rpmdelivery.courier.ui.CourierApp
import com.rpmdelivery.courier.ui.theme.CourierTheme

class MainActivity : ComponentActivity() {
    private val auth by lazy { ViewModelProvider(this)[CourierAuthViewModel::class.java] }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // This foundation intentionally uses a light theme, including in system dark mode.
        val bars = SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
        enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
        setContent {
            CourierTheme { CourierApp(auth.controller) }
        }
        consumeCallback(intent)
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        consumeCallback(intent)
    }
    private fun consumeCallback(incoming: Intent?) {
        if (incoming?.action != Intent.ACTION_VIEW) return
        val callback = incoming.dataString ?: return
        incoming.data = null
        // Never forward, log, save or render the URI. The repository validates it and the pending PKCE verifier.
        auth.controller.confirm(callback)
    }
    override fun onStart() {
        super.onStart()
        if (auth.controller.state.value.authenticated) auth.controller.reload()
    }
}
