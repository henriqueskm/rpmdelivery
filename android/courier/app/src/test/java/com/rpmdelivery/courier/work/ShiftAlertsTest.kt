package com.rpmdelivery.courier.work

import org.junit.Assert.*
import org.junit.Test

class ShiftAlertsTest {
    private val store = Store("r-1", "Cozinha da Vila", "ACTIVE")
    private fun home(status: String, position: Int? = null, route: CourierRoute? = null, shiftId: String = "s-1") =
        CourierHome(listOf(store), Shift(shiftId, "r-1", "Cozinha da Vila", status, position), route)
    private fun route(released: Boolean, status: String = "PREPARING", id: String = "route-1") = CourierRoute(
        id, status, 1, null, released, StoreContact("Cozinha da Vila", null, null, null, null), emptyList())

    @Test fun staysAwakeOnlyWhileAPickupIsAboutToBeReleased() {
        assertTrue("first in line", awaitingPickup(home("AVAILABLE", 1)))
        assertTrue("route being assembled", awaitingPickup(home("AVAILABLE", route = route(false))))
        assertFalse("further back in line", awaitingPickup(home("AVAILABLE", 3)))
        assertFalse("waiting for approval", awaitingPickup(home("PENDING")))
        assertFalse("already released", awaitingPickup(home("AVAILABLE", route = route(true))))
        assertFalse("on the street", awaitingPickup(home("ON_ROUTE", route = route(true, "ON_ROUTE"))))
        assertFalse("no shift", awaitingPickup(CourierHome(listOf(store), null, null)))
    }

    @Test fun shiftEndedByTheStoreRingsOnceAndSaysWhoAndWhen() {
        val ended = ShiftEnded("s-1", "Cozinha da Vila", "2026-11-25T02:40:00+00:00")
        val after = CourierHome(listOf(store), null, null, shiftEndedByStore = ended)
        assertEquals(listOf(ShiftAlert.SHIFT_ENDED_BY_STORE), alertsBetween(home("AVAILABLE", 2), after))
        assertEquals("Cozinha da Vila encerrou seu turno às 23:40.", shiftEndedText(ended, java.time.ZoneId.of("America/Sao_Paulo")))
        // The courier ended it, or it is an older shift's notice: nothing to say.
        assertEquals(emptyList<ShiftAlert>(), alertsBetween(home("AVAILABLE", 2), CourierHome(listOf(store), null, null)))
        assertEquals(emptyList<ShiftAlert>(), alertsBetween(home("AVAILABLE", 2, shiftId = "s-2"), after))
        // Already told: no shift before either.
        assertEquals(emptyList<ShiftAlert>(), alertsBetween(after, after))
        assertEquals("A loja encerrou seu turno.", shiftEndedText(ShiftEnded("s-1", "", null)))
    }

    @Test fun homeSaysWhenTheStoreEndedTheShift() {
        fun parse(json: String) = parseHome(kotlinx.serialization.json.Json.parseToJsonElement(json))
        val home = parse("""{"stores":[],"shift":null,"route":null,
            "shiftEndedByStore":{"shiftId":"s-1","restaurantName":"Cozinha da Vila","endedAt":"2026-11-25T02:40:00+00:00"}}""")
        assertEquals(ShiftEnded("s-1", "Cozinha da Vila", "2026-11-25T02:40:00+00:00"), home.shiftEndedByStore)
        assertNull(parse("""{"stores":[],"shift":null,"route":null,"shiftEndedByStore":null}""").shiftEndedByStore)
        assertNull("older servers do not send it", parse("""{"stores":[],"shift":null,"route":null}""").shiftEndedByStore)
    }

    @Test fun firstReadNeverRings() {
        assertEquals(emptyList<ShiftAlert>(), alertsBetween(null, home("AVAILABLE", 1)))
        assertEquals(emptyList<ShiftAlert>(), alertsBetween(null, home("AVAILABLE", route = route(true))))
    }

    @Test fun approvalAndFirstInLine() {
        assertEquals(listOf(ShiftAlert.APPROVED), alertsBetween(home("PENDING"), home("AVAILABLE", 2)))
        assertEquals(listOf(ShiftAlert.APPROVED, ShiftAlert.NEXT_IN_LINE), alertsBetween(home("PENDING"), home("AVAILABLE", 1)))
        assertEquals(listOf(ShiftAlert.NEXT_IN_LINE), alertsBetween(home("AVAILABLE", 2), home("AVAILABLE", 1)))
    }

    @Test fun staysQuietWhileNothingNewHappens() {
        assertEquals(emptyList<ShiftAlert>(), alertsBetween(home("AVAILABLE", 1), home("AVAILABLE", 1)))
        assertEquals(emptyList<ShiftAlert>(), alertsBetween(home("AVAILABLE", 3), home("AVAILABLE", 2)))
        // A route being assembled reserves the courier: no "first in line" then.
        assertEquals(emptyList<ShiftAlert>(), alertsBetween(home("AVAILABLE", 1), home("AVAILABLE", route = route(false))))
        assertEquals(emptyList<ShiftAlert>(), alertsBetween(home("AVAILABLE", route = route(true)), home("AVAILABLE", route = route(true))))
    }

    @Test fun releasedPickupRingsOncePerRoute() {
        assertEquals(listOf(ShiftAlert.PICKUP_RELEASED), alertsBetween(home("AVAILABLE", route = route(false)), home("AVAILABLE", route = route(true))))
        assertEquals(listOf(ShiftAlert.PICKUP_RELEASED), alertsBetween(home("AVAILABLE", 1), home("AVAILABLE", route = route(true))))
        // Released again after the store revoked and changed it: ring again.
        assertEquals(listOf(ShiftAlert.PICKUP_RELEASED), alertsBetween(home("AVAILABLE", route = route(true, id = "route-1")),
            home("AVAILABLE", route = route(true, id = "route-2"))))
        // Started by the courier: nothing to announce.
        assertEquals(emptyList<ShiftAlert>(), alertsBetween(home("AVAILABLE", route = route(true)), home("ON_ROUTE", route = route(true, "ON_ROUTE"))))
    }

    @Test fun endedShiftOrANewShiftDoNotRing() {
        assertEquals(emptyList<ShiftAlert>(), alertsBetween(home("AVAILABLE", 1), CourierHome(listOf(store), null, null)))
        assertEquals(emptyList<ShiftAlert>(), alertsBetween(home("PENDING", shiftId = "s-1"), home("AVAILABLE", 2, shiftId = "s-2")))
    }

    @Test fun alertTextsNameTheStoreAndNeverACustomer() {
        val waiting = home("AVAILABLE", 1)
        assertTrue(alertText(ShiftAlert.NEXT_IN_LINE, waiting).contains("Cozinha da Vila"))
        assertTrue(alertText(ShiftAlert.APPROVED, waiting).contains("Cozinha da Vila"))
        // Without card, Pix or change on the route there is nothing else to take (PaymentTest covers the rest).
        assertEquals("Pegue os pedidos no balcão. Deslize para iniciar a rota.", alertText(ShiftAlert.PICKUP_RELEASED, waiting))
    }

    @Test fun bufferSendsOldestFirstInBatchesOfAHundredAndKeepsTheNewest() {
        val buffer = LocationBuffer(capacity = 250)
        repeat(300) { buffer.add(GpsPoint(-23.5, -46.6, 5.0, "2026-11-14T12:00:${it}Z")) }
        assertEquals(250, buffer.size)
        val first = buffer.batch()
        assertEquals(100, first.size)
        assertEquals("the 50 oldest were dropped", "2026-11-14T12:00:50Z", first.first().recordedAt)
        buffer.drop(first.size)
        assertEquals(150, buffer.size)
        buffer.drop(1_000)
        assertEquals(0, buffer.size)
        assertTrue(buffer.batch().isEmpty())
    }
}
