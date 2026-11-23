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

    @Test fun arrivalByGpsSaysTheCourierIsBackInLine() = runTest {
        val work = WorkController(fake, this, onExpired = { expired++ })
        fake.requestShift("r-1"); fake.approve(); fake.assign(); fake.release()
        fake.startRoute("route-1", 2)
        work.refresh(); advanceUntilIdle()
        repeat(2) {
            val route = work.state.value.home!!.route!!
            work.completeDelivery(route, route.next!!); advanceUntilIdle()
        }
        assertEquals("RETURNING", work.state.value.home!!.route!!.status)

        // The server closed the way back by GPS: no swipe, the next read finds the courier in line.
        fake.home = fake.home.copy(route = null, shift = fake.home.shift!!.copy(status = "AVAILABLE", queuePosition = 1))
        work.refresh(); advanceUntilIdle()
        assertNull(work.state.value.home!!.route)
        assertEquals(ARRIVED_BY_GPS, work.state.value.notice)
        assertFalse("the swipe was not needed", fake.calls.contains("arrive_at_store"))
        // It stays while nothing else changes.
        work.refresh(); advanceUntilIdle()
        assertEquals(ARRIVED_BY_GPS, work.state.value.notice)
    }

    @Test fun swipeOnTheWayBackKeepsItsOwnNotice() = runTest {
        val work = WorkController(fake, this, onExpired = { expired++ })
        fake.requestShift("r-1"); fake.approve(); fake.assign(); fake.release()
        fake.startRoute("route-1", 2)
        work.refresh(); advanceUntilIdle()
        repeat(2) {
            val route = work.state.value.home!!.route!!
            work.completeDelivery(route, route.next!!); advanceUntilIdle()
        }
        work.arriveAtStore(work.state.value.home!!.route!!); advanceUntilIdle()
        assertEquals("Chegada registrada. Você voltou para a fila.", work.state.value.notice)
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
        // Each settled stop brings the next customer up: the server may have a "você é o próximo" to send.
        val route = work.state.value.home!!.route!!
        work.completeDelivery(route, route.next!!); advanceUntilIdle()
        assertEquals(2, fake.notified)
        val after = work.state.value.home!!.route!!
        work.reportFailure(after, after.next!!, FailureReason.CUSTOMER_NOT_RESPONDING, ""); advanceUntilIdle()
        assertEquals(3, fake.notified)
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

    @Test fun approvedStoresCarryTheirContactAndRefusedLinksComeApart() {
        val home = parseHome(Json.parseToJsonElement("""{"shift":null,"route":null,
            "stores":[{"restaurantId":"r-1","name":"Cozinha da Vila","linkStatus":"ACTIVE","phone":"+5511987650099",
                       "address":"Rua Loja 9, Itatiba","latitude":-23.0059,"longitude":-46.839},
                      {"restaurantId":"r-2","name":"Outra","linkStatus":"PENDING","phone":null,"address":null,"latitude":null,"longitude":null}],
            "refusedStores":[{"restaurantId":"r-3","name":"Pizzaria","linkStatus":"REJECTED","since":"2026-11-20T15:00:00+00:00"},
                             {"restaurantId":"r-4","name":"Lanches","linkStatus":"SUSPENDED","since":null}]}"""))
        assertEquals(Store("r-1", "Cozinha da Vila", "ACTIVE", "+5511987650099", "Rua Loja 9, Itatiba", -23.0059, -46.839), home.stores[0])
        assertEquals(Store("r-2", "Outra", "PENDING"), home.stores[1])
        assertEquals(listOf("r-3", "r-4"), home.refusedStores.map { it.restaurantId })
        assertFalse(home.refusedStores[0].suspended)
        assertTrue(home.refusedStores[1].suspended)
        assertEquals("2026-11-20T15:00:00+00:00", home.refusedStores[0].since)
        // An older server without the new fields still reads.
        assertEquals(emptyList<RefusedStore>(), parseHome(Json.parseToJsonElement("""{"stores":[],"shift":null,"route":null}""")).refusedStores)
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
        assertEquals("sáb., 14/11", historyDate("2026-11-14"))
    }

    @Test fun deletingTheAccountWaitsForTheShiftToEndThenSignsOut() = runTest {
        var deleted = 0
        val work = WorkController(fake, this, onExpired = { expired++ }, onAccountDeleted = { deleted++ })
        fake.requestShift("r-1"); fake.approve()
        work.refresh(); advanceUntilIdle()
        work.deleteAccount(); advanceUntilIdle()
        assertEquals("Encerre o turno antes de excluir a conta.", work.state.value.message)
        assertEquals(0, deleted)
        assertFalse(work.state.value.busy)

        fake.endShift("shift-1")
        work.deleteAccount(); advanceUntilIdle()
        assertEquals(1, deleted)
        assertNull("nothing of the account stays on screen", work.state.value.home)
        assertEquals(2, fake.calls.count { it == "delete_account" })

        // The server could not finish: say so and let the courier try again.
        fake.failOnce("delete_account", WorkProblem.refused("DELETE_UNAVAILABLE"))
        work.deleteAccount(); advanceUntilIdle()
        assertEquals("Não foi possível excluir a conta agora. Tente de novo mais tarde.", work.state.value.message)
        assertEquals(1, deleted)
    }

    @Test fun theProfilePhotoIsReadWhenMeuCadastroOpensThenSavedAndRemoved() = runTest {
        val work = WorkController(fake, this, onExpired = { expired++ })
        fake.photo = byteArrayOf(1, 2, 3)
        work.show(Section.Profile); advanceUntilIdle()
        assertArrayEquals(byteArrayOf(1, 2, 3), work.state.value.photo)
        assertFalse(work.state.value.photoLoading)

        work.savePhoto { byteArrayOf(9, 9) }; advanceUntilIdle()
        assertArrayEquals(byteArrayOf(9, 9), fake.photo)
        assertArrayEquals(byteArrayOf(9, 9), work.state.value.photo)
        assertEquals("Foto salva. As lojas em que você trabalha já veem a nova foto.", work.state.value.notice)
        assertFalse(work.state.value.photoSaving)

        // An image the phone could not open never reaches the server.
        work.savePhoto { null }; advanceUntilIdle()
        assertEquals("Não foi possível abrir esta imagem. Escolha outra foto.", work.state.value.message)
        assertEquals(1, fake.calls.count { it == "save_photo" })

        // No connection: the old photo stays, and the courier can try again.
        fake.failOnce("save_photo", WorkProblem.network())
        work.savePhoto { byteArrayOf(7) }; advanceUntilIdle()
        assertEquals(WorkProblem.network().safeMessage, work.state.value.message)
        assertArrayEquals(byteArrayOf(9, 9), work.state.value.photo)

        work.removePhoto(); advanceUntilIdle()
        assertNull(fake.photo)
        assertNull(work.state.value.photo)
        assertEquals("Foto removida.", work.state.value.notice)

        fake.failOnce("photo", WorkProblem.expired())
        work.show(Section.Profile); advanceUntilIdle()
        assertEquals(1, expired)
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
