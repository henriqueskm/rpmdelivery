package com.rpmdelivery.courier.shift

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.ImageView
import com.rpmdelivery.courier.R
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * A small round button over other apps (the maps app, mostly) while a route is in progress and the
 * courier is outside RpmDelivery. One tap brings the app back; it can be dragged out of the way.
 * Shown only with Android's "sobrepor outros apps" permission, which the courier turns on in
 * Avisos e permissões. Main thread only. It carries no customer data.
 */
// The one view lives over other apps, outside any Activity: it is built from the application
// context only (never a screen's) and dropped as soon as it hides, so nothing can leak through it.
@SuppressLint("StaticFieldLeak")
object RouteBubble {
    private var routeActive = false
    private var appVisible = true
    @SuppressLint("StaticFieldLeak")
    private var view: View? = null

    /** The route is ON_ROUTE or RETURNING. */
    fun setRoute(context: Context, active: Boolean) { routeActive = active; update(context) }
    /** RpmDelivery is on screen: the bubble would only cover it. */
    fun setAppVisible(context: Context, visible: Boolean) { appVisible = visible; update(context) }

    fun shouldShow(routeActive: Boolean, appVisible: Boolean, allowed: Boolean) = routeActive && !appVisible && allowed
    fun allowed(context: Context): Boolean = Settings.canDrawOverlays(context)
    val shown: Boolean get() = view != null

    private fun update(context: Context) {
        val app = context.applicationContext
        if (shouldShow(routeActive, appVisible, allowed(app))) show(app) else hide(app)
    }

    @SuppressLint("ClickableViewAccessibility") // The touch listener calls performClick on a tap.
    private fun show(context: Context) {
        if (view != null) return
        val density = context.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).roundToInt()
        val bubble = ImageView(context).apply {
            setImageResource(R.drawable.brand_bolt)
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(0xFFFB673B.toInt()) }
            elevation = dp(6).toFloat()
            setPadding(dp(6), dp(6), dp(6), dp(6))
            contentDescription = "Voltar para o RpmDelivery"
            setOnClickListener { open(context) }
        }
        val params = WindowManager.LayoutParams(dp(56), dp(56), WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.END
            x = dp(12); y = dp(160)
        }
        val slop = ViewConfiguration.get(context).scaledTouchSlop
        var startX = 0; var startY = 0; var downX = 0f; var downY = 0f; var dragging = false
        val windows = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        bubble.setOnTouchListener { touched, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> { startX = params.x; startY = params.y; downX = event.rawX; downY = event.rawY; dragging = false }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downX; val dy = event.rawY - downY
                    if (dragging || abs(dx) > slop || abs(dy) > slop) {
                        dragging = true
                        // Anchored at the right edge: moving right brings it closer to the edge.
                        params.x = (startX - dx).roundToInt().coerceAtLeast(0)
                        params.y = (startY + dy).roundToInt().coerceAtLeast(0)
                        windows.updateViewLayout(touched, params)
                    }
                }
                MotionEvent.ACTION_UP -> if (!dragging) touched.performClick()
            }
            true
        }
        try { windows.addView(bubble, params); view = bubble } catch (_: RuntimeException) { /* Permission revoked meanwhile. */ }
    }

    private fun hide(context: Context) {
        val current = view ?: return
        view = null
        try { (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeView(current) } catch (_: RuntimeException) { }
    }

    private fun open(context: Context) {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
        context.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
    }
}
