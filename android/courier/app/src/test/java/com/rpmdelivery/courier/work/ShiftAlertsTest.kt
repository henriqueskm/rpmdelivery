package com.rpmdelivery.courier.work

import org.junit.Assert.*
import org.junit.Test

class ShiftAlertsTest {
    private val store = Store("r-1", "Cozinha da Vila", "ACTIVE")
    private fun home(status: String, position: Int? = null, route: CourierRoute? = null, shiftId: String = "s-1") =
        CourierHome(listOf(store), Shift(shiftId, "r-1", "Cozinha da Vila", status, position), route)
    private fun route(released: Boolean, status: String = "PREPARING", id: String = "route-1") = CourierRoute(
        id, status, 1, null, released, StoreContact("Cozinha da Vila", null, null, null, null), emptyList())

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
        assertEquals("Pegue os pedidos no balcão e deslize para iniciar a rota.", alertText(ShiftAlert.PICKUP_RELEASED, waiting))
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
