package com.rpmdelivery.courier.work

/** Moments worth a sound on the courier's phone while it is in the pocket. */
enum class ShiftAlert(val id: Int, val title: String) {
    APPROVED(2001, "Turno aprovado"),
    NEXT_IN_LINE(2002, "Você é o próximo da fila"),
    PICKUP_RELEASED(2003, "Rota pronta para retirada"),
}

fun alertText(alert: ShiftAlert, home: CourierHome): String = when (alert) {
    ShiftAlert.APPROVED -> "${home.shift?.restaurantName.orEmpty()} aprovou seu turno. Você está na fila.".trim()
    ShiftAlert.NEXT_IN_LINE -> "A próxima rota de ${home.shift?.restaurantName.orEmpty()} é sua. Fique por perto."
    ShiftAlert.PICKUP_RELEASED -> "Pegue os pedidos no balcão e deslize para iniciar a rota."
}

/**
 * What changed between two reads that the courier should hear about. The first read after the
 * watcher starts has nothing to compare with and alerts nothing: the courier just saw that screen.
 */
fun alertsBetween(before: CourierHome?, after: CourierHome): List<ShiftAlert> {
    if (before == null) return emptyList()
    val alerts = mutableListOf<ShiftAlert>()
    val was = before.shift
    val now = after.shift ?: return emptyList()
    if (was?.shiftId == now.shiftId && was.status == "PENDING" && now.status == "AVAILABLE") alerts += ShiftAlert.APPROVED
    val firstNow = now.status == "AVAILABLE" && now.queuePosition == 1 && after.route == null
    val firstBefore = was?.shiftId == now.shiftId && was.status == "AVAILABLE" && was.queuePosition == 1 && before.route == null
    if (firstNow && !firstBefore) alerts += ShiftAlert.NEXT_IN_LINE
    val route = after.route
    if (route != null && route.status == "PREPARING" && route.pickupReleased) {
        val seen = before.route?.let { it.routeId == route.routeId && it.status == "PREPARING" && it.pickupReleased } ?: false
        if (!seen) alerts += ShiftAlert.PICKUP_RELEASED
    }
    return alerts
}

/** One GPS reading, in the shape record_courier_locations() accepts. */
data class GpsPoint(val latitude: Double, val longitude: Double, val accuracy: Double?, val recordedAt: String)

/**
 * Readings waiting to be sent, oldest first. A lost signal keeps them; past [capacity] the oldest go,
 * since the live position only moves forward and the newest points matter most.
 */
class LocationBuffer(private val capacity: Int = 1_000) {
    private val points = ArrayDeque<GpsPoint>()
    val size: Int @Synchronized get() = points.size
    @Synchronized fun add(point: GpsPoint) {
        if (points.size >= capacity) points.removeFirst()
        points.addLast(point)
    }
    /** The oldest batch, at most 100 points: the server's limit per call. */
    @Synchronized fun batch(max: Int = 100): List<GpsPoint> = points.take(max)
    @Synchronized fun drop(count: Int) { repeat(minOf(count, points.size)) { points.removeFirst() } }
    @Synchronized fun clear() = points.clear()
}
