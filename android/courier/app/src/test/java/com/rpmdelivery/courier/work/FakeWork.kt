package com.rpmdelivery.courier.work

/** In-memory courier server: follows the same transitions as the SQL commands, with synthetic data only. */
internal class FakeWork : CourierWorkRepository {
    val store = Store("r-1", "Cozinha da Vila", "ACTIVE")
    var home = CourierHome(listOf(store), null, null)
    val calls = mutableListOf<String>()
    val requestIds = mutableListOf<String>()
    var notified = 0
    private val failures = mutableMapOf<String, WorkProblem>()

    /** The next call named [name] fails once with [problem]. */
    fun failOnce(name: String, problem: WorkProblem) { failures[name] = problem }
    private fun record(name: String) {
        calls += name
        failures.remove(name)?.let { throw it }
    }

    // Store side, as the panel would do it.
    fun approve() { home = home.copy(shift = home.shift!!.copy(status = "AVAILABLE", queuePosition = 1)) }
    fun assign() {
        home = home.copy(shift = home.shift!!.copy(queuePosition = null), route = CourierRoute(
            routeId = "route-1", status = "PREPARING", version = 2, nextDeliveryId = null, pickupReleased = false,
            store = StoreContact("Cozinha da Vila", "+551130000000", "Rua da Loja, 10", -23.55, -46.63),
            stops = listOf(
                stop("d-1", 1, "Helena Prado", "Rua das Acácias, 55", notes = "Portão azul, tocar duas vezes", reference = "1048"),
                stop("d-2", 2, "Igor Nunes", "Avenida Paulista, 900"),
            )))
    }
    fun release() { home = home.copy(route = home.route!!.copy(pickupReleased = true)) }

    private fun stop(id: String, sequence: Int, name: String, address: String, notes: String? = null, reference: String? = null) =
        Stop(id, sequence, "ASSIGNED", false, name, address, "Apto 12", "Vila Mariana", reference, notes,
            -23.58, -46.64, "2026-11-14T15:30:00+00:00", 0)

    private fun advance(route: CourierRoute, stops: List<Stop>): CourierRoute {
        val next = stops.firstOrNull { it.status == "ON_ROUTE" }
        return if (next == null) route.copy(status = "RETURNING", nextDeliveryId = null, stops = stops)
        else route.copy(nextDeliveryId = next.deliveryId, stops = stops.map { if (it == next) it.copy(status = "NEXT") else it })
    }
    private fun update(deliveryId: String, status: String) {
        val route = home.route!!
        home = home.copy(route = advance(route, route.stops.map {
            if (it.deliveryId == deliveryId) it.copy(status = status, attempts = it.attempts + 1) else it
        }))
    }

    override suspend fun home(): CourierHome { record("home"); return home }
    override suspend fun requestShift(restaurantId: String) {
        record("request_shift")
        home = home.copy(shift = Shift("shift-1", restaurantId, "Cozinha da Vila", "PENDING", null))
    }
    override suspend fun endShift(shiftId: String) { record("end_shift"); home = home.copy(shift = null) }
    override suspend fun startRoute(routeId: String, version: Int) {
        record("start_route:$version")
        val route = home.route!!
        if (!route.pickupReleased) throw WorkProblem.refused("RPM_PICKUP_NOT_RELEASED")
        home = home.copy(shift = home.shift!!.copy(status = "ON_ROUTE"),
            route = advance(route.copy(status = "ON_ROUTE"), route.stops.map { it.copy(status = "ON_ROUTE") }))
    }
    override suspend fun completeDelivery(requestId: String, routeId: String, deliveryId: String) {
        requestIds += requestId
        record("complete_delivery:$deliveryId")
        update(deliveryId, "DELIVERED")
    }
    override suspend fun reportFailure(requestId: String, routeId: String, deliveryId: String, reason: FailureReason, notes: String) {
        requestIds += requestId
        record("report_delivery_failure:$deliveryId:${reason.name}:$notes")
        update(deliveryId, "ATTEMPT_FAILED")
    }
    override suspend fun arriveAtStore(routeId: String) {
        record("arrive_at_store")
        home = home.copy(route = null, shift = home.shift!!.copy(status = "AVAILABLE", queuePosition = 2))
    }
    override suspend fun notifyCustomers(routeId: String) { notified++ }
}
