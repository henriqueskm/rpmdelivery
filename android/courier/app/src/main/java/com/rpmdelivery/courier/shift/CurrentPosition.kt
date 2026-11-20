package com.rpmdelivery.courier.shift

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.rpmdelivery.courier.work.GpsPoint
import java.time.Instant

/**
 * Where the phone is at the moment of a swipe, for the distance check. During the route the shift
 * service keeps GPS on, so the last reading is seconds old; nothing new is requested here.
 * Returns null without permission, without a reading from the last 2 minutes, or with a fake one.
 */
object CurrentPosition {
    private const val MAX_AGE_MS = 120_000L

    fun read(context: Context, now: Long = System.currentTimeMillis()): GpsPoint? {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return null
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val latest = try {
            listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
                .mapNotNull { provider -> runCatching { manager.getLastKnownLocation(provider) }.getOrNull() }
                .filter { !it.isFake() && now - it.time in 0..MAX_AGE_MS }
                .maxByOrNull { it.time }
        } catch (_: SecurityException) { null } ?: return null
        return latest.toPoint()
    }
}

/** Readings from "fake GPS" apps never reach the store, the customer's map or a distance check. */
fun Location.isFake(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) isMock
    else @Suppress("DEPRECATION") isFromMockProvider

fun Location.toPoint(): GpsPoint = GpsPoint(latitude, longitude,
    if (hasAccuracy()) accuracy.toDouble() else null, Instant.ofEpochMilli(time).toString())
