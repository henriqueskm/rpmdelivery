package com.rpmdelivery.courier.shift

import android.Manifest
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.rpmdelivery.courier.CourierGraph
import com.rpmdelivery.courier.work.CourierHome
import com.rpmdelivery.courier.work.CourierWorkRepository
import com.rpmdelivery.courier.work.GpsPoint
import com.rpmdelivery.courier.work.LocationBuffer
import com.rpmdelivery.courier.work.WorkProblem
import com.rpmdelivery.courier.work.alertsBetween
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Runs while the courier has an open shift, so the phone can stay in the pocket.
 * - Waiting: reads the shift every 30 s and rings when approved, first in line, or the pickup is released.
 * - On the route (ON_ROUTE and RETURNING only): also shares GPS every 15 s with the store and the next customer.
 * It stops when the shift ends, the session expires or the courier signs out. No location is read while waiting.
 */
class ShiftService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var repository: CourierWorkRepository
    private val buffer = LocationBuffer()
    private var loop: Job? = null
    private var last: CourierHome? = null
    private var trackingRoute: String? = null

    // Every method spelled out: before Android 11 the provider callbacks have no default body.
    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            buffer.add(GpsPoint(location.latitude, location.longitude,
                if (location.hasAccuracy()) location.accuracy.toDouble() else null,
                Instant.ofEpochMilli(location.time).toString()))
        }
        override fun onProviderEnabled(provider: String) = Unit
        override fun onProviderDisabled(provider: String) = Unit
        @Deprecated("Required before Android 11")
        @Suppress("OVERRIDE_DEPRECATION")
        override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) = Unit
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        repository = CourierGraph.get(this).work
        ShiftNotifications.createChannels(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Android requires the foreground notification right away.
        promote(tracking = trackingRoute != null)
        if (loop?.isActive != true) loop = scope.launch {
            while (isActive) {
                tick()
                delay(if (trackingRoute != null) TRACKING_MS else WAITING_MS)
            }
        }
        // After the process dies, the app starts it again when opened with an open shift.
        return START_NOT_STICKY
    }

    private suspend fun tick() {
        val home = try { repository.home() }
        catch (error: CancellationException) { throw error }
        catch (error: WorkProblem) {
            if (error.expired) { ShiftNotifications.sessionEnded(this); finish() }
            return // No connection: try again on the next tick, keeping the GPS buffer.
        } catch (_: Exception) { return }

        alertsBetween(last, home).forEach { ShiftNotifications.alert(this, it, home) }
        last = home
        if (home.shift == null) { send(); finish(); return }

        val route = home.route?.takeIf { it.status == "ON_ROUTE" || it.status == "RETURNING" }
        if (route != null && trackingRoute != route.routeId) startTracking(route.routeId)
        if (route == null && trackingRoute != null) { send(); stopTracking() }
        send()
        refreshOngoing(home)
    }

    /** Sends what the buffer holds, at most 100 points per call, while the route is in progress. */
    private suspend fun send() {
        val routeId = trackingRoute ?: return
        while (buffer.size > 0) {
            val batch = buffer.batch()
            try {
                repository.recordLocations(routeId, batch)
                buffer.drop(batch.size)
            } catch (error: CancellationException) { throw error }
            catch (error: WorkProblem) {
                // The route ended or the points were refused: they will never be accepted, drop them.
                if (error.code == "RPM_ROUTE_STATE" || error.code == "RPM_LOCATION_FIELDS" || error.code == "RPM_ROUTE_NOT_FOUND") buffer.drop(batch.size)
                return
            } catch (_: Exception) { return }
        }
    }

    private fun startTracking(routeId: String) {
        stopTracking()
        // Precise or approximate: the network provider still gives the customer a moving point.
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return
        if (!promote(tracking = true)) return
        val manager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        try {
            for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                if (manager.isProviderEnabled(provider))
                    manager.requestLocationUpdates(provider, POINT_MS, POINT_METERS, listener, Looper.getMainLooper())
            }
            trackingRoute = routeId
        } catch (_: SecurityException) { promote(tracking = false) }
    }

    private fun stopTracking() {
        if (trackingRoute == null) return
        (getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(listener)
        trackingRoute = null
        buffer.clear()
        promote(tracking = false)
    }

    /** Foreground with the type the moment needs: location only while sharing it. */
    private fun promote(tracking: Boolean): Boolean {
        val type = when {
            tracking && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE -> ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            else -> 0
        }
        return try {
            ServiceCompat.startForeground(this, ShiftNotifications.ONGOING_ID,
                ShiftNotifications.ongoing(this, last, tracking), type)
            true
        } catch (_: RuntimeException) {
            // Android refused the location type (permission revoked, app not allowed now): keep the alerts.
            if (tracking) promote(tracking = false) else false
        }
    }

    private fun refreshOngoing(home: CourierHome) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        NotificationManagerCompat.from(this).notify(ShiftNotifications.ONGOING_ID,
            ShiftNotifications.ongoing(this, home, trackingRoute != null))
    }

    private fun finish() {
        loop?.cancel(); loop = null
        if (trackingRoute != null) {
            (getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(listener)
            trackingRoute = null
        }
        buffer.clear()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        if (trackingRoute != null) (getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(listener)
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val WAITING_MS = 30_000L
        private const val TRACKING_MS = 15_000L
        private const val POINT_MS = 5_000L
        private const val POINT_METERS = 10f

        /** Called by the app while it is visible, which Android requires to start a foreground service. */
        fun start(context: Context) {
            try { ContextCompat.startForegroundService(context, Intent(context, ShiftService::class.java)) }
            catch (_: IllegalStateException) { /* Not allowed right now; the next visible moment starts it. */ }
        }
        /** Sign-out or a shift ended on screen: stop at once, without waiting for the next read. */
        fun stop(context: Context) {
            context.stopService(Intent(context, ShiftService::class.java))
        }
    }
}
