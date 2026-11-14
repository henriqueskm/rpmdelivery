package com.rpmdelivery.courier.work

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test
import java.time.ZoneId

@OptIn(ExperimentalCoroutinesApi::class)
class WorkControllerTest {
    private val fake = FakeWork()
    private var expired = 0

    @Test fun retryAfterLostAnswerReusesTheSameRequestId() = runTest {
        val work = WorkController(fake, this, onExpired = { expired++ })
        fake.requestShift("r-1"); fake.approve(); fake.assign(); fake.release()
        fake.startRoute("route-1", 2)
        work.refresh(); advanceUntilIdle()
        val route = work.state.value.home!!.route!!
        val next = route.next!!

        fake.failOnce("complete_delivery:d-1", WorkProblem.network())
        work.completeDelivery(route, next); advanceUntilIdle()
        assertEquals(WorkProblem.network().safeMessage, work.state.value.message)
        work.completeDelivery(route, next); advanceUntilIdle()
        assertEquals(2, fake.requestIds.size)
        assertEquals("the retry must carry the first request id", fake.requestIds[0], fake.requestIds[1])
        assertEquals("Entrega concluída.", work.state.value.notice)
        assertEquals("d-2", work.state.value.home!!.route!!.nextDeliveryId)
    }

    @Test fun refusalShowsTheStoreSentenceAndReloads() = runTest {
        val work = WorkController(fake, this, onExpired = { expired++ })
        fake.requestShift("r-1"); fake.approve(); fake.assign()
        work.refresh(); advanceUntilIdle()
        val reads = fake.calls.count { it == "home" }
        work.startRoute(work.state.value.home!!.route!!); advanceUntilIdle()
        assertEquals(WorkCopy.forCode("RPM_PICKUP_NOT_RELEASED"), work.state.value.message)
        assertTrue(fake.calls.count { it == "home" } > reads)
        assertEquals(0, fake.notified)
    }

    @Test fun startingNotifiesCustomersOnce() = runTest {
        val work = WorkController(fake, this, onExpired = { expired++ })
        fake.requestShift("r-1"); fake.approve(); fake.assign(); fake.release()
        work.refresh(); advanceUntilIdle()
        work.startRoute(work.state.value.home!!.route!!); advanceUntilIdle()
        assertEquals(1, fake.notified)
        assertEquals("ON_ROUTE", work.state.value.home!!.route!!.status)
    }

    @Test fun droppedConnectionKeepsTheLastScreen() = runTest {
        val work = WorkController(fake, this, onExpired = { expired++ })
        work.refresh(); advanceUntilIdle()
        fake.failOnce("home", WorkProblem.network())
        work.refresh(); advanceUntilIdle()
        assertTrue(work.state.value.offline)
        assertNotNull(work.state.value.home)
        assertNull(work.state.value.message)
        work.refresh(); advanceUntilIdle()
        assertFalse(work.state.value.offline)
    }

    @Test fun firstReadWithoutConnectionAsksToRetry() = runTest {
        val work = WorkController(fake, this, onExpired = { expired++ })
        fake.failOnce("home", WorkProblem.network())
        work.refresh(); advanceUntilIdle()
        assertNull(work.state.value.home)
        assertEquals(WorkProblem.network().safeMessage, work.state.value.message)
        work.refresh(); advanceUntilIdle()
        assertNotNull(work.state.value.home)
        assertNull(work.state.value.message)
    }

    @Test fun expiredSessionClearsTheScreenAndSignsOut() = runTest {
        val work = WorkController(fake, this, onExpired = { expired++ })
        work.refresh(); advanceUntilIdle()
        fake.failOnce("request_shift", WorkProblem.expired())
        work.requestShift(fake.store); advanceUntilIdle()
        assertEquals(1, expired)
        assertNull(work.state.value.home)
    }

    @Test fun busyCommandIgnoresASecondTap() = runTest {
        val work = WorkController(fake, this, onExpired = { expired++ })
        work.refresh(); advanceUntilIdle()
        work.requestShift(fake.store); work.requestShift(fake.store); advanceUntilIdle()
        assertEquals(1, fake.calls.count { it == "request_shift" })
    }

    @Test fun noticeStaysUntilTheStoreChangesTheScreen() = runTest {
        val work = WorkController(fake, this, onExpired = { expired++ })
        work.refresh(); advanceUntilIdle()
        work.requestShift(fake.store); advanceUntilIdle()
        assertEquals("Turno pedido em Cozinha da Vila. Aguarde a loja aprovar.", work.state.value.notice)
        work.refresh(); advanceUntilIdle()
        assertNotNull("nothing changed yet", work.state.value.notice)
        fake.approve()
        work.refresh(); advanceUntilIdle()
        assertNull("the approval makes the old notice stale", work.state.value.notice)
    }

    @Test fun homeContractIsParsedWithoutAnyCustomerPhone() {
        val home = parseHome(Json.parseToJsonElement("""
            {"serverNow":"2026-11-14T12:00:00+00:00",
             "stores":[{"restaurantId":"r-1","name":"Cozinha da Vila","linkStatus":"ACTIVE"},
                       {"restaurantId":"r-2","name":"Outra","linkStatus":"PENDING"}],
             "shift":{"shiftId":"s-1","restaurantId":"r-1","restaurantName":"Cozinha da Vila","status":"ON_ROUTE",
                      "requestedAt":"2026-11-14T11:00:00+00:00","availableSince":null,"queuePosition":null},
             "route":{"routeId":"route-1","status":"ON_ROUTE","version":3,"nextDeliveryId":"d-2",
                      "pickupReleasedAt":"2026-11-14T11:30:00+00:00","startedAt":"2026-11-14T11:31:00+00:00",
                      "restaurant":{"name":"Cozinha da Vila","phone":"+551130000000","address":"Rua da Loja, 10","latitude":-23.5,"longitude":-46.6},
                      "stops":[
                        {"deliveryId":"d-1","sequence":1,"status":"DELIVERED","retryQueuedAt":null,"customerName":"Helena",
                         "address":"Rua A, 1","complement":null,"neighborhood":"Centro","reference":"1048","notes":null,
                         "latitude":null,"longitude":null,"deadlineAt":"2026-11-14T15:30:00.123456+00:00","attempts":1},
                        {"deliveryId":"d-2","sequence":2,"status":"NEXT","retryQueuedAt":"2026-11-14T11:50:00+00:00","customerName":"Igor",
                         "address":"Rua B, 2","complement":"Apto 3","neighborhood":null,"reference":null,"notes":"Portão azul",
                         "latitude":-23.58,"longitude":-46.64,"deadlineAt":null,"attempts":1}]}}
        """.trimIndent()))
        assertEquals(listOf(true, false), home.stores.map { it.active })
        assertNull(home.shift!!.queuePosition)
        val route = home.route!!
        assertEquals(3, route.version)
        assertTrue(route.pickupReleased)
        assertEquals("Igor", route.next!!.customerName)
        assertTrue(route.next!!.retryQueued)
        assertEquals("Nova tentativa", stopLabel(route.stops[1].copy(status = "ON_ROUTE")))
        assertEquals(1, route.delivered)
        assertNull(route.stops[0].latitude)
        assertEquals("12:30", clockTime(route.stops[0].deadlineAt, ZoneId.of("America/Sao_Paulo")))
    }

    @Test fun todayAndHistoryAreParsedAndFormattedInReais() {
        val home = parseHome(Json.parseToJsonElement("""{"stores":[],"shift":null,"route":null,
            "today":{"deliveries":3,"shiftFeeCents":3000,"deliveryFeesCents":2100,"totalCents":5100}}"""))
        assertEquals(Today(3, 3000, 2100, 5100), home.today)
        assertNull(parseHome(Json.parseToJsonElement("""{"stores":[],"shift":null,"route":null}""")).today)
        assertTrue(runCatching { parseHome(Json.parseToJsonElement("""{"stores":[],"today":{"deliveries":-1,"shiftFeeCents":0,"deliveryFeesCents":0,"totalCents":0}}""")) }
            .exceptionOrNull() is WorkProblem)
        val history = parseHistory(Json.parseToJsonElement("""[{"day":"2026-11-14","restaurantName":"Cozinha da Vila",
            "deliveries":3,"shiftFeeCents":3000,"deliveryFeesCents":2100,"totalCents":5100}]"""))
        assertEquals(HistoryDay("2026-11-14", "Cozinha da Vila", 3, 3000, 2100, 5100), history.single())
        assertTrue(runCatching { parseHistory(Json.parseToJsonElement("{}")) }.exceptionOrNull() is WorkProblem)
        assertEquals("R$ 51,00", reais(5100))
        assertEquals("R$ 1.234,05", reais(123405))
        assertEquals("R$ 0,00", reais(0))
        assertEquals("sex., 14/11", historyDate("2026-11-14"))
    }

    @Test fun historyLoadsAndAnExpiredSessionSignsOut() = runTest {
        val work = WorkController(fake, this, onExpired = { expired++ })
        work.loadHistory(); advanceUntilIdle()
        assertEquals(2, work.state.value.history!!.size)
        fake.failOnce("history", WorkProblem.network())
        work.loadHistory(); advanceUntilIdle()
        assertEquals(WorkProblem.network().safeMessage, work.state.value.historyError)
        assertEquals("the last good list stays", 2, work.state.value.history!!.size)
        fake.failOnce("history", WorkProblem.expired())
        work.loadHistory(); advanceUntilIdle()
        assertEquals(1, expired)
    }

    @Test fun emptyHomeAndBrokenAnswers() {
        val empty = parseHome(Json.parseToJsonElement("""{"serverNow":"x","stores":[],"shift":null,"route":null}"""))
        assertTrue(empty.stores.isEmpty()); assertNull(empty.shift); assertNull(empty.route)
        assertTrue(runCatching { parseHome(Json.parseToJsonElement("null")) }.exceptionOrNull() is WorkProblem)
        assertTrue(runCatching { parseHome(Json.parseToJsonElement("""{"stores":[{"name":"sem id"}]}""")) }.exceptionOrNull() is WorkProblem)
        assertNull(clockTime("não é data"))
    }
}
