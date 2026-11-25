package com.rpmdelivery.courier.work

/** Moments worth a sound on the courier's phone while it is in the pocket. */
enum class ShiftAlert(val id: Int, val title: String) {
    APPROVED(2001, "Turno aprovado"),
    NEXT_IN_LINE(2002, "Você é o próximo da fila"),
    PICKUP_RELEASED(2003, "Rota pronta para retirada"),
    SHIFT_ENDED_BY_STORE(2004, "Turno encerrado pela loja"),
    ARRIVED(2005, "Chegada registrada"),
}

fun alertText(alert: ShiftAlert, home: CourierHome): String = when (alert) {
    ShiftAlert.APPROVED -> if (home.shift?.onTheWay == true)
        "${home.shift.restaurantName} aprovou seu turno. Venha para a loja: você entra na fila ao chegar.".trim()
        else "${home.shift?.restaurantName.orEmpty()} aprovou seu turno. Você está na fila.".trim()
    ShiftAlert.ARRIVED -> "Você entrou na fila de ${home.shift?.restaurantName.orEmpty()}" +
        (home.shift?.queuePosition?.let { ": ${it}º." } ?: ".")
    ShiftAlert.NEXT_IN_LINE -> "A próxima rota de ${home.shift?.restaurantName.orEmpty()} é sua. Fique por perto."
    ShiftAlert.PICKUP_RELEASED -> pickupText(home.route)
    ShiftAlert.SHIFT_ENDED_BY_STORE -> home.shiftEndedByStore?.let(::shiftEndedText) ?: "A loja encerrou seu turno."
}

/** "Pegue os pedidos no balcão e a maquininha. Leve R$ 48,00 de troco. Deslize para iniciar a rota." */
fun pickupText(route: CourierRoute?): String {
    val kit = route?.let(::routeKit)
    return buildString {
        append("Pegue os pedidos no balcão")
        if (kit?.needsMachine == true) append(" e a maquininha")
        append(".")
        if (kit != null && kit.changeStops > 0) append(" Leve ${reais(kit.changeCents)} de troco.")
        append(" Deslize para iniciar a rota.")
    }
}

/**
 * What changed between two reads that the courier should hear about. The first read after the
 * watcher starts has nothing to compare with and alerts nothing: the courier just saw that screen.
 */
fun alertsBetween(before: CourierHome?, after: CourierHome): List<ShiftAlert> {
    if (before == null) return emptyList()
    val alerts = mutableListOf<ShiftAlert>()
    val was = before.shift
    // The shift was there and is gone because the store ended it ("Fechar o dia"): say so.
    if (after.shift == null) {
        return if (was != null && after.shiftEndedByStore?.shiftId == was.shiftId) listOf(ShiftAlert.SHIFT_ENDED_BY_STORE)
        else emptyList()
    }
    val now = after.shift
    if (was?.shiftId == now.shiftId && was.status == "PENDING" && now.status == "AVAILABLE") alerts += ShiftAlert.APPROVED
    val firstNow = now.status == "AVAILABLE" && now.queuePosition == 1 && after.route == null
    val firstBefore = was?.shiftId == now.shiftId && was.status == "AVAILABLE" && was.queuePosition == 1 && before.route == null
    if (firstNow && !firstBefore) alerts += ShiftAlert.NEXT_IN_LINE
    // Arrived at the store (GPS, swipe or the counter): in line now. "Próximo da fila" already says it.
    else if (was?.shiftId == now.shiftId && was.onTheWay && !now.onTheWay && now.status == "AVAILABLE") alerts += ShiftAlert.ARRIVED
    val route = after.route
    if (route != null && route.status == "PREPARING" && route.pickupReleased) {
        val seen = before.route?.let { it.routeId == route.routeId && it.status == "PREPARING" && it.pickupReleased } ?: false
        if (!seen) alerts += ShiftAlert.PICKUP_RELEASED
    }
    return alerts
}

/**
 * The release of a pickup is about to come: the courier is first in line, or the store is putting
 * their route together. Only then the phone stays awake and asks often, so "rota pronta" rings within
 * seconds even in deep sleep. The rest of the shift it sleeps as usual (asking every 30 s, which Android
 * may stretch with the screen off).
 */
fun awaitingPickup(home: CourierHome): Boolean {
    val route = home.route
    if (route != null) return route.status == "PREPARING" && !route.pickupReleased
    val shift = home.shift ?: return false
    return shift.status == "AVAILABLE" && shift.queuePosition == 1
}

/** Where an approved courier on the way must arrive: the shift's store, when it has a pin. */
data class ArrivalTarget(val shiftId: String, val latitude: Double, val longitude: Double)

fun arrivalTarget(home: CourierHome): ArrivalTarget? {
    val shift = home.shift?.takeIf { it.status == "AVAILABLE" && it.onTheWay } ?: return null
    val store = home.stores.find { it.restaurantId == shift.restaurantId } ?: return null
    return if (store.latitude != null && store.longitude != null) ArrivalTarget(shift.shiftId, store.latitude, store.longitude) else null
}

/**
 * The same rule as the server's arrive_for_shift(auto): within 100 m of the store pin, with accuracy
 * 50 m or better (unknown accuracy counts). Checked on the phone first, so the server is only asked
 * once the courier is really there.
 */
fun atStore(point: GpsPoint, target: ArrivalTarget): Boolean =
    (point.accuracy ?: 0.0) <= 50.0 && meters(point.latitude, point.longitude, target.latitude, target.longitude) <= 100

/** Great-circle distance, as private.distance_meters on the server. */
fun meters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Int {
    val dLat = Math.toRadians(lat2 - lat1)
    val dLon = Math.toRadians(lon2 - lon1)
    val a = Math.sin(dLat / 2).let { it * it } +
        Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.sin(dLon / 2).let { it * it }
    return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(a))).toInt()
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
