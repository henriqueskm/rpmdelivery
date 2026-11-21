package com.rpmdelivery.courier.shift

import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.net.toUri
import com.rpmdelivery.courier.MainActivity

/**
 * "Rota pronta para retirada" wakes the phone: the screen turns on and RpmDelivery opens on the route,
 * even from the pocket with the screen off and locked. The courier asked for it: the counter is waiting.
 * - Screen off or locked: Android's full-screen notification opens the app over the lock screen.
 *   Since Android 14 that needs "Notificações em tela cheia", which the courier turns on in Avisos e permissões.
 * - Screen on, courier in another app: with "sobrepor outros apps" (the route bubble's permission) the
 *   app opens at once; without it, the notification drops down from the top as usual.
 */
object PickupWake {
    const val EXTRA = "com.rpmdelivery.courier.WAKE_FOR_PICKUP"

    fun intent(context: Context): Intent = Intent(context, MainActivity::class.java)
        .putExtra(EXTRA, true)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)

    /** Whether Android lets the alert open the app over the lock screen. */
    fun allowed(context: Context): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
        context.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()

    /** Android's own page for "Notificações em tela cheia" (Android 14+); null before, where it is always on. */
    fun settings(context: Context): Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
        Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, "package:${context.packageName}".toUri()) else null

    /** Screen on and unlocked: the full-screen notification would only drop down, so open the app directly. */
    fun openNow(context: Context) {
        val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (!power.isInteractive || !RouteBubble.allowed(context)) return
        try { context.startActivity(intent(context)) }
        catch (_: ActivityNotFoundException) { }
        catch (_: SecurityException) { /* Android refused a start from the background: the notification still rings. */ }
    }
}
