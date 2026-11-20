package com.rpmdelivery.courier.work

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

/** "Entregue" far from the address asks first; "cheguei" far from the store is refused with the distance. */
@OptIn(ExperimentalCoroutinesApi::class)
class DistanceCheckTest {
    private val fake = FakeWork()
    private val here = GpsPoint(-23.0058, -46.8389, 8.0, "2026-11-20T12:00:00Z")

    private suspend fun kotlinx.coroutines.test.TestScope.onRoute(): WorkController {
        val work = WorkController(fake, this, onExpired = {})
        fake.requestShift("r-1"); fake.approve(); fake.assign(); fake.release()
        fake.startRoute("route-1", 2)
        work.refresh(); advanceUntilIdle()
        return work
    }

    @Test fun serverRefusalsCarryTheDistance() {
        val address = WorkProblem.fromServer("RPM_FAR_FROM_ADDRESS 1234")
        assertEquals(WorkProblem.FAR_FROM_ADDRESS, address.code)
        assertEquals(1234, address.meters)
        val store = WorkProblem.fromServer("{\"message\":\"RPM_FAR_FROM_STORE 2900\"}")
        assertEquals("Você está a 2,9 km da loja. Deslize em \"cheguei\" quando estiver nela.", store.safeMessage)
        assertEquals("RPM_PICKUP_NOT_RELEASED", WorkProblem.fromServer("RPM_PICKUP_NOT_RELEASED").code)
        assertEquals("350 m", WorkCopy.distance(347))
        assertEquals("2 km", WorkCopy.distance(2000))
    }

    @Test fun farDeliveryAsksThenConfirmsWithTheSameRequest() = runTest {
        val work = onRoute()
        val route = work.state.value.home!!.route!!
        val stop = route.next!!
        fake.farFromAddress = 1200

        work.completeDelivery(route, stop, here); advanceUntilIdle()
        val prompt = work.state.value.farPrompt!!
        assertEquals(1200, prompt.meters)
        assertEquals(stop.customerName, prompt.customerName)
        assertNull("the question replaces the error line", work.state.value.message)
        assertEquals(stop.deliveryId, work.state.value.home!!.route!!.nextDeliveryId)

        work.confirmFarDelivery(); advanceUntilIdle()
        assertNull(work.state.value.farPrompt)
        assertEquals("Entrega concluída.", work.state.value.notice)
        assertEquals("confirming repeats the very same request", fake.requestIds[0], fake.requestIds[1])
        assertTrue(fake.calls.contains("complete_delivery:${stop.deliveryId}:far"))
        assertEquals(here, fake.positions.last())
    }

    @Test fun cancellingTheQuestionLeavesTheStopAsItWas() = runTest {
        val work = onRoute()
        val route = work.state.value.home!!.route!!
        fake.farFromAddress = 800
        work.completeDelivery(route, route.next!!, here); advanceUntilIdle()
        work.cancelFarDelivery()
        assertNull(work.state.value.farPrompt)
        assertEquals(route.next!!.deliveryId, work.state.value.home!!.route!!.nextDeliveryId)
        work.confirmFarDelivery(); advanceUntilIdle()
        assertFalse("nothing is sent after cancelling", fake.calls.any { it.endsWith(":far") })
    }

    @Test fun withoutAPositionNothingIsAsked() = runTest {
        val work = onRoute()
        val route = work.state.value.home!!.route!!
        fake.farFromAddress = 5000
        work.completeDelivery(route, route.next!!, position = null); advanceUntilIdle()
        assertNull(work.state.value.farPrompt)
        assertEquals("Entrega concluída.", work.state.value.notice)
    }

    @Test fun waitingForTheStoreSettlesTheRouteOnEachRead() = runTest {
        val work = onRoute()
        // Last stop failed and the store has not decided: nothing next, still on the route.
        fake.home = fake.home.copy(route = fake.home.route!!.copy(nextDeliveryId = null,
            stops = fake.home.route!!.stops.map { it.copy(status = "ATTEMPT_FAILED") }))
        work.refresh(); advanceUntilIdle()
        assertEquals("ON_ROUTE", work.state.value.home!!.route!!.status)
        assertTrue("the read asks the server to settle", "settle_courier_route" in fake.calls)
        // Ten minutes later the deadline passes: the same read brings the route back home.
        fake.deadlinePassed = true
        work.refresh(); advanceUntilIdle()
        assertEquals("RETURNING", work.state.value.home!!.route!!.status)
    }

    @Test fun aRouteWithANextStopIsNeverSettled() = runTest {
        val work = onRoute()
        work.refresh(); advanceUntilIdle()
        assertFalse("settle_courier_route" in fake.calls)
    }

    @Test fun arrivalFarFromTheStoreSaysHowFar() = runTest {
        val work = onRoute()
        fake.home = fake.home.copy(route = fake.home.route!!.copy(status = "RETURNING", nextDeliveryId = null))
        work.refresh(); advanceUntilIdle()
        fake.farFromStore = 2900
        work.arriveAtStore(work.state.value.home!!.route!!, here); advanceUntilIdle()
        assertEquals(WorkCopy.far(WorkProblem.FAR_FROM_STORE, 2900), work.state.value.message)
        assertNotNull("still heading back", work.state.value.home!!.route)
    }
}
