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
import android.os.PowerManager
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.rpmdelivery.courier.CourierGraph
import com.rpmdelivery.courier.work.CourierHome
import com.rpmdelivery.courier.work.CourierWorkRepository
import com.rpmdelivery.courier.work.LocationBuffer
import com.rpmdelivery.courier.work.ShiftAlert
import com.rpmdelivery.courier.work.WorkProblem
import com.rpmdelivery.courier.work.ArrivalTarget
import com.rpmdelivery.courier.work.alertsBetween
import com.rpmdelivery.courier.work.arrivalTarget
import com.rpmdelivery.courier.work.atStore
import com.rpmdelivery.courier.work.awaitingPickup
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Runs while the courier has an open shift, so the phone can stay in the pocket.
 * - Waiting: reads the shift every 30 s and rings when approved, first in line, or the pickup is released.
 * - On the route (ON_ROUTE and RETURNING only): also shares GPS every 15 s with the store and the next customer.
 * - Approved but not at the store yet ("a caminho"): reads GPS on the phone only, and tells the server once the
 *   phone is within 100 m of the store, which puts the courier in line. Nothing is shared on the way.
 * It stops when the shift ends, the session expires or the courier signs out. No location is read in line.
 */
class ShiftService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var repository: CourierWorkRepository
    private val buffer = LocationBuffer()
    private var loop: Job? = null
    private var last: CourierHome? = null
    private var trackingRoute: String? = null
    /** On the way to the store of an approved shift: where to arrive. */
    private var approaching: ArrivalTarget? = null
    private var arrival: Job? = null
    private var lastArrivalTry = 0L
    private val locating get() = trackingRoute != null || approaching != null
    private var dispatch: Job? = null
    private var lastDispatch = 0L
    /** First in line or route being assembled: ask every 10 s and keep the processor awake. */
    private var urgent = false
    private var wakeLock: PowerManager.WakeLock? = null

    /**
     * Android stops the processor when the screen is off (deep sleep), stretching "every 10 s" into
     * minutes. Only while a pickup is about to be released, a partial wake lock keeps it running (the
     * screen stays off). It renews on every read and lapses by itself if reads stop.
     */
    private fun stayAwake(on: Boolean) {
        if (on) {
            val lock = wakeLock ?: (getSystemService(Context.POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RpmDelivery:pickup").also {
                    it.setReferenceCounted(false); wakeLock = it
                }
            lock.acquire(WAKE_LOCK_MS)
        } else {
            wakeLock?.takeIf { it.isHeld }?.release()
            wakeLock = null
        }
    }

    // Every method spelled out: before Android 11 the provider callbacks have no default body.
    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            if (location.isFake()) return
            buffer.add(location.toPoint())
        }
        override fun onProviderEnabled(provider: String) = Unit
        override fun onProviderDisabled(provider: String) = Unit
        @Deprecated("Required before Android 11")
        @Suppress("OVERRIDE_DEPRECATION")
        override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) = Unit
    }

    /** On the way: readings stay on the phone; only the arrival goes to the server. */
    private val approachListener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            if (location.isFake()) return
            val target = approaching ?: return
            val point = location.toPoint()
            if (atStore(point, target)) arrive(point)
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
        promote(tracking = locating)
        // The app is visible now: the only moment Android lets the location start on the way to the store.
        last?.let(::arrivalTarget)?.let { if (approaching == null) startApproach(it) }
        if (loop?.isActive != true) loop = scope.launch {
            while (isActive) {
                tick()
                delay(when {
                    trackingRoute != null -> TRACKING_MS
                    urgent -> URGENT_MS
                    else -> WAITING_MS
                })
            }
        }
        // After the process dies, the app starts it again when opened with an open shift.
        return START_NOT_STICKY
    }

    private suspend fun tick() {
        val home = try {
            val read = repository.home()
            // Phone in the pocket while the store decides the last occurrence: past its deadline the
            // server sends the route back, so the courier is told to return without opening the app.
            if (read.route?.let { it.status == "ON_ROUTE" && it.nextDeliveryId == null } == true) {
                repository.settleRoute(read.route.routeId)
                repository.home()
            } else read
        }
        catch (error: CancellationException) { throw error }
        catch (error: WorkProblem) {
            if (error.expired) { ShiftNotifications.sessionEnded(this); finish() }
            return // No connection: try again on the next tick, keeping the GPS buffer.
        } catch (_: Exception) { return }

        alertsBetween(last, home).forEach {
            ShiftNotifications.alert(this, it, home)
            if (it == ShiftAlert.PICKUP_RELEASED) PickupWake.openNow(this)
        }
        last = home
        urgent = awaitingPickup(home)
        stayAwake(urgent)
        if (home.shift == null) { send(); finish(); return }

        val target = arrivalTarget(home)
        if (target != null && approaching?.shiftId != target.shiftId) startApproach(target)
        if (target == null && approaching != null) stopApproach()

        val route = home.route?.takeIf { it.status == "ON_ROUTE" || it.status == "RETURNING" }
        // The app may be in the background (maps app open): the service keeps the bubble in step.
        RouteBubble.setRoute(this, route != null)
        if (route != null && trackingRoute != route.routeId) startTracking(route.routeId)
        if (route == null && trackingRoute != null) { send(); stopTracking() }
        send()
        if (route?.status == "ON_ROUTE") notifyCustomers(route.routeId)
        refreshOngoing(home)
    }

    /**
     * The GPS just sent may have put the courier near the next customer, which queues "está chegando" on
     * the server; the dispatch sends it (and anything else waiting). At most every 30 s, off the loop:
     * a slow or missing function never delays the next GPS batch.
     */
    private fun notifyCustomers(routeId: String) {
        val now = System.currentTimeMillis()
        if (dispatch?.isActive == true || now - lastDispatch < DISPATCH_MS) return
        lastDispatch = now
        dispatch = scope.launch {
            try { repository.notifyCustomers(routeId) }
            catch (error: CancellationException) { throw error }
            catch (_: Exception) { /* Nothing to do: the next one picks up what is left. */ }
        }
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
        promote(tracking = locating)
    }

    private fun startApproach(target: ArrivalTarget) {
        stopApproach()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return
        approaching = target
        // Refused with the app in the background (Android 14+): the next time the app shows, it starts.
        if (!promote(tracking = true)) { approaching = null; return }
        val manager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        try {
            for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                if (manager.isProviderEnabled(provider))
                    manager.requestLocationUpdates(provider, POINT_MS, POINT_METERS, approachListener, Looper.getMainLooper())
            }
        } catch (_: SecurityException) { approaching = null; promote(tracking = locating) }
    }

    private fun stopApproach() {
        if (approaching == null) return
        (getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(approachListener)
        approaching = null
        arrival?.cancel(); arrival = null
        promote(tracking = locating)
    }

    /** At the store: the server checks the same rule and puts the courier in line. At most every 20 s. */
    private fun arrive(point: com.rpmdelivery.courier.work.GpsPoint) {
        val now = System.currentTimeMillis()
        if (arrival?.isActive == true || now - lastArrivalTry < ARRIVAL_RETRY_MS) return
        lastArrivalTry = now
        arrival = scope.launch {
            try {
                repository.arriveForShift(point, auto = true)
                stopApproach()
                tick() // In line now: the notification and the "chegada registrada" sound right away.
            } catch (error: CancellationException) { throw error }
            catch (_: Exception) { /* Not there yet for the server, or no connection: the next reading tries again. */ }
        }
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
        stayAwake(false)
        stopApproach()
        if (trackingRoute != null) {
            (getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(listener)
            trackingRoute = null
        }
        buffer.clear()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        stayAwake(false)
        RouteBubble.setRoute(this, false)
        if (trackingRoute != null) (getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(listener)
        if (approaching != null) (getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(approachListener)
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val WAITING_MS = 30_000L
        private const val TRACKING_MS = 15_000L
        private const val POINT_MS = 5_000L
        private const val POINT_METERS = 10f
        private const val DISPATCH_MS = 30_000L
        private const val URGENT_MS = 10_000L
        private const val ARRIVAL_RETRY_MS = 20_000L
        /** Renewed on every read; if reads stop (no network, crash), the processor sleeps again after this. */
        private const val WAKE_LOCK_MS = 2 * 60_000L

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
