package com.rpmdelivery.courier.work

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** A store the courier is linked to. Only ACTIVE links can ask for a shift. */
data class Store(val restaurantId: String, val name: String, val linkStatus: String) {
    val active: Boolean get() = linkStatus == "ACTIVE"
}

/** The courier's open shift. [queuePosition] exists only while waiting in line. */
data class Shift(
    val shiftId: String,
    val restaurantId: String,
    val restaurantName: String,
    val status: String,
    val queuePosition: Int?,
    /** When the courier entered the line (approval or last return to the store). */
    val availableSince: String? = null,
)

/** The store on the route: where to return. No customer phone ever reaches the app. */
data class StoreContact(
    val name: String,
    val phone: String?,
    val address: String?,
    val latitude: Double?,
    val longitude: Double?,
)

data class Stop(
    val deliveryId: String,
    val sequence: Int,
    val status: String,
    val retryQueued: Boolean,
    val customerName: String,
    val address: String,
    val complement: String?,
    val neighborhood: String?,
    val reference: String?,
    val notes: String?,
    val latitude: Double?,
    val longitude: Double?,
    val deadlineAt: String?,
    val attempts: Int,
)

data class CourierRoute(
    val routeId: String,
    val status: String,
    val version: Int,
    val nextDeliveryId: String?,
    val pickupReleased: Boolean,
    val store: StoreContact,
    val stops: List<Stop>,
) {
    val next: Stop? get() = stops.firstOrNull { it.deliveryId == nextDeliveryId }
    val delivered: Int get() = stops.count { it.status == "DELIVERED" }
    /** Stops already settled on the street: delivered, waiting for the store or going back. */
    val settled: Int get() = stops.count { it.status in setOf("DELIVERED", "ATTEMPT_FAILED", "RETURN_TO_STORE", "CANCELLED") }
    val toReturn: Int get() = stops.count { it.status in setOf("ATTEMPT_FAILED", "RETURN_TO_STORE") }
}

/** What the courier did and earned today, across stores (encosta + deliveries). */
data class Today(val deliveries: Int, val shiftFeeCents: Int, val deliveryFeesCents: Int, val totalCents: Int)

/** One day at one store in the history. */
data class HistoryDay(
    val day: String,
    val restaurantName: String,
    val deliveries: Int,
    val shiftFeeCents: Int,
    val deliveryFeesCents: Int,
    val totalCents: Int,
)

data class CourierHome(val stores: List<Store>, val shift: Shift?, val route: CourierRoute?, val today: Today? = null)

/** 3700 → "R$ 37,00". */
fun reais(cents: Int): String = "R$ " + java.text.NumberFormat.getNumberInstance(java.util.Locale.forLanguageTag("pt-BR")).apply {
    minimumFractionDigits = 2; maximumFractionDigits = 2
}.format(cents / 100.0)

/** "2026-11-14" → "sex., 14/11" in Portuguese. */
fun historyDate(day: String): String = runCatching {
    java.time.LocalDate.parse(day).format(DateTimeFormatter.ofPattern("EEE, dd/MM", java.util.Locale.forLanguageTag("pt-BR")))
}.getOrDefault(day)

private fun JsonObject.cents(key: String): Int = text(key)?.toIntOrNull()?.takeIf { it >= 0 } ?: throw WorkProblem(WorkCopy.UNEXPECTED)

fun parseHistory(element: JsonElement): List<HistoryDay> {
    val days = element as? JsonArray ?: throw WorkProblem(WorkCopy.UNEXPECTED)
    return days.map { item ->
        val day = item as? JsonObject ?: throw WorkProblem(WorkCopy.UNEXPECTED)
        HistoryDay(day.required("day"), day.text("restaurantName").orEmpty(), day.cents("deliveries"),
            day.cents("shiftFeeCents"), day.cents("deliveryFeesCents"), day.cents("totalCents"))
    }
}

enum class FailureReason(val label: String) {
    CUSTOMER_NOT_FOUND("Cliente não estava no local"),
    CUSTOMER_NOT_RESPONDING("Cliente não atende"),
    ADDRESS_PROBLEM("Problema no endereço"),
    OTHER("Outro motivo"),
}

/** Labels the courier reads on each stop. */
fun stopLabel(stop: Stop): String = when (stop.status) {
    "NEXT" -> "Agora"
    "ON_ROUTE" -> if (stop.retryQueued) "Nova tentativa" else "Na sequência"
    "ASSIGNED" -> "Na rota"
    "DELIVERED" -> "Entregue"
    "ATTEMPT_FAILED" -> "Aguardando a loja"
    "RETURN_TO_STORE" -> "Devolver na loja"
    "CANCELLED" -> "Cancelada pela loja"
    else -> "Na rota"
}

/** Local clock time (HH:mm) of a server timestamp, or null when absent or unreadable. */
fun clockTime(value: String?, zone: ZoneId = ZoneId.systemDefault()): String? = value?.let {
    runCatching { OffsetDateTime.parse(it).atZoneSameInstant(zone).format(DateTimeFormatter.ofPattern("HH:mm")) }.getOrNull()
}

private fun JsonObject.text(key: String): String? =
    (this[key] as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content
private fun JsonObject.required(key: String): String = text(key) ?: throw WorkProblem(WorkCopy.UNEXPECTED)
private fun JsonObject.child(key: String): JsonObject? = this[key] as? JsonObject
private fun JsonObject.list(key: String): List<JsonObject> = (this[key] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }

/** Reads get_courier_home(). Anything outside the contract is refused instead of guessed. */
fun parseHome(element: JsonElement): CourierHome {
    val root = element as? JsonObject ?: throw WorkProblem(WorkCopy.UNEXPECTED)
    return CourierHome(
        stores = root.list("stores").map { Store(it.required("restaurantId"), it.required("name"), it.required("linkStatus")) },
        shift = root.child("shift")?.let {
            Shift(it.required("shiftId"), it.required("restaurantId"), it.text("restaurantName").orEmpty(),
                it.required("status"), it.text("queuePosition")?.toIntOrNull(), it.text("availableSince"))
        },
        route = root.child("route")?.let(::parseRoute),
        today = root.child("today")?.let {
            Today(it.cents("deliveries"), it.cents("shiftFeeCents"), it.cents("deliveryFeesCents"), it.cents("totalCents"))
        },
    )
}

fun parseRoute(route: JsonObject): CourierRoute {
    val store = route.child("restaurant")
    return CourierRoute(
        routeId = route.required("routeId"),
        status = route.required("status"),
        version = route.required("version").toIntOrNull() ?: throw WorkProblem(WorkCopy.UNEXPECTED),
        nextDeliveryId = route.text("nextDeliveryId"),
        pickupReleased = route.text("pickupReleasedAt") != null,
        store = StoreContact(store?.text("name").orEmpty(), store?.text("phone"), store?.text("address"),
            store?.text("latitude")?.toDoubleOrNull(), store?.text("longitude")?.toDoubleOrNull()),
        stops = route.list("stops").map { stop ->
            Stop(
                deliveryId = stop.required("deliveryId"),
                sequence = stop.text("sequence")?.toIntOrNull() ?: 0,
                status = stop.required("status"),
                retryQueued = stop.text("retryQueuedAt") != null,
                customerName = stop.text("customerName").orEmpty(),
                address = stop.text("address").orEmpty(),
                complement = stop.text("complement"),
                neighborhood = stop.text("neighborhood"),
                reference = stop.text("reference"),
                notes = stop.text("notes"),
                latitude = stop.text("latitude")?.toDoubleOrNull(),
                longitude = stop.text("longitude")?.toDoubleOrNull(),
                deadlineAt = stop.text("deadlineAt"),
                attempts = stop.text("attempts")?.toIntOrNull() ?: 0,
            )
        },
    )
}
