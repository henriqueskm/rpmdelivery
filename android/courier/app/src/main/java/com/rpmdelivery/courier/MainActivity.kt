package com.rpmdelivery.courier

import android.os.Build
import android.os.Bundle
import android.content.Intent
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.ViewModelProvider
import com.rpmdelivery.courier.auth.CourierAuthViewModel
import com.rpmdelivery.courier.ui.CourierApp
import com.rpmdelivery.courier.ui.theme.CourierTheme
import com.rpmdelivery.courier.work.InviteLink
import com.rpmdelivery.courier.shift.PickupWake
import com.rpmdelivery.courier.shift.RouteBubble
import com.rpmdelivery.courier.shift.ShiftNotifications
import com.rpmdelivery.courier.work.Section
import com.rpmdelivery.courier.work.ShiftAlert

class MainActivity : ComponentActivity() {
    private val auth by lazy { ViewModelProvider(this)[CourierAuthViewModel::class.java] }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // This foundation intentionally uses a light theme, including in system dark mode.
        val bars = SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
        enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
        setContent {
            CourierTheme { CourierApp(auth.controller, auth.work) }
        }
        consumeCallback(intent)
        wakeForPickup(intent)
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        consumeCallback(intent)
        wakeForPickup(intent)
    }

    /**
     * Opened by "Rota pronta para retirada" (PickupWake): turn the screen on and show the route over the
     * lock screen, on the home where the swipe to start is. Only for this opening: leaving the app puts
     * the lock screen back in front of it.
     */
    private fun wakeForPickup(incoming: Intent?) {
        if (incoming?.getBooleanExtra(PickupWake.EXTRA, false) != true) return
        incoming.removeExtra(PickupWake.EXTRA)
        showOverLockScreen(true)
        ShiftNotifications.cancel(this, ShiftAlert.PICKUP_RELEASED)
        auth.work.show(Section.Home)
    }

    @Suppress("DEPRECATION") // The window flags are the only way on Android 8.0 (API 26).
    private fun showOverLockScreen(on: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(on)
            setTurnScreenOn(on)
        } else {
            val flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            if (on) window.addFlags(flags) else window.clearFlags(flags)
        }
        woke = on
    }
    private var woke = false
    private fun consumeCallback(incoming: Intent?) {
        if (incoming?.action != Intent.ACTION_VIEW) return
        val callback = incoming.dataString ?: return
        incoming.data = null
        // Never forward, log, save or render the URI. A store invite (QR Code or link) carries only its code;
        // anything else goes to the repository, which validates it and the pending PKCE verifier.
        val invite = InviteLink.code(callback)
        if (invite != null) auth.work.receiveInvite(invite) else auth.controller.confirm(callback)
    }
    override fun onStart() {
        super.onStart()
        if (auth.controller.state.value.authenticated) auth.controller.reload()
        RouteBubble.setAppVisible(this, true)
        // The route screen reads only while the app is visible: no background work in this version.
        auth.work.setForeground(true)
    }
    override fun onStop() {
        auth.work.setForeground(false)
        // Out of the app during a route (the maps app, mostly): the bubble brings it back in one tap.
        RouteBubble.setAppVisible(this, false)
        if (woke) showOverLockScreen(false)
        super.onStop()
    }
}
