package com.rpmdelivery.courier.work

import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class PaymentTest {
    private fun stop(id: String, status: String, payment: StopPayment?) =
        Stop(id, 1, status, false, "Cliente", "Rua A, 1", null, null, null, null, null, null, null, 0, payment)
    private fun route(vararg stops: Stop) = CourierRoute("route-1", "PREPARING", 1, null, true,
        StoreContact("Cozinha da Vila", null, null, null, null), stops.toList())

    @Test fun eachStopSaysWhetherToCollectAndHowMuch() {
        assertEquals("Já pago · não cobrar", paymentTitle(StopPayment("PAID", null, null)))
        assertNull(paymentDetail(StopPayment("PAID", null, null)))
        assertEquals("Cobrar R$ 45,90 no cartão", paymentTitle(StopPayment("CARD", 4590, null)))
        assertEquals("Na maquininha", paymentDetail(StopPayment("CARD", 4590, null)))
        assertEquals("Cobrar R$ 30,00 no Pix", paymentTitle(StopPayment("PIX", 3000, null)))
        assertEquals("Cobrar R$ 52,90 em dinheiro", paymentTitle(StopPayment("CASH", 5290, 10000)))
        assertEquals("Troco para R$ 100,00: devolva R$ 47,10", paymentDetail(StopPayment("CASH", 5290, 10000)))
        assertNull("exact cash, no change", paymentDetail(StopPayment("CASH", 5290, null)))
        assertEquals("Pagamento não informado", paymentTitle(null))
        assertEquals("Confirme com a loja se está pago antes de entregar.", paymentDetail(null))
    }

    @Test fun theRouteSaysWhatToTakeFromTheStore() {
        val kit = routeKit(route(
            stop("d-1", "ASSIGNED", StopPayment("CARD", 4590, null)),
            stop("d-2", "ASSIGNED", StopPayment("PIX", 3000, null)),
            stop("d-3", "ASSIGNED", StopPayment("CASH", 5290, 10000)),
            stop("d-4", "ASSIGNED", StopPayment("CASH", 1500, 2000)),
            stop("d-5", "ASSIGNED", StopPayment("PAID", null, null)),
            stop("d-6", "ASSIGNED", null),
            // Already delivered or cancelled: nothing more to take for it.
            stop("d-7", "DELIVERED", StopPayment("CARD", 1000, null)),
            stop("d-8", "CANCELLED", StopPayment("CASH", 1000, 5000)),
        ))
        assertEquals(RouteKit(machineStops = 2, changeCents = 5210, changeStops = 2, unknownStops = 1), kit)
        assertEquals(listOf("Maquininha: 2 entregas no cartão ou Pix", "Troco: R$ 52,10 para 2 entregas em dinheiro",
            "1 entrega sem pagamento informado: pergunte na loja"), kitLines(kit))
        assertTrue(routeKit(route(stop("d-1", "ASSIGNED", StopPayment("PAID", null, null)))).isEmpty)
        assertFalse(routeKit(route(stop("d-1", "ASSIGNED", StopPayment("CASH", 5290, null)))).needsMachine)
    }

    @Test fun pickupNotificationTellsToTakeTheMachineAndTheChange() {
        assertEquals("Pegue os pedidos no balcão e a maquininha. Leve R$ 47,10 de troco. Deslize para iniciar a rota.",
            pickupText(route(stop("d-1", "ASSIGNED", StopPayment("CARD", 4590, null)), stop("d-2", "ASSIGNED", StopPayment("CASH", 5290, 10000)))))
        assertEquals("Pegue os pedidos no balcão. Deslize para iniciar a rota.",
            pickupText(route(stop("d-1", "ASSIGNED", StopPayment("PAID", null, null)))))
        assertEquals("Pegue os pedidos no balcão. Deslize para iniciar a rota.", pickupText(null))
    }

    @Test fun routeContractCarriesThePaymentAndNeverGuessesIt() {
        fun payment(json: String) = parseRoute(Json.parseToJsonElement("""
            {"routeId":"route-1","status":"PREPARING","version":1,"nextDeliveryId":null,"pickupReleasedAt":null,
             "stops":[{"deliveryId":"d-1","sequence":1,"status":"ASSIGNED","customerName":"Helena","address":"Rua A, 1",
                       "payment":$json}]}
        """.trimIndent()) as kotlinx.serialization.json.JsonObject).stops.single().payment
        assertEquals(StopPayment("CASH", 5290, 10000), payment("""{"method":"CASH","amountDueCents":5290,"changeForCents":10000}"""))
        assertEquals(StopPayment("PAID", null, null), payment("""{"method":"PAID","amountDueCents":null,"changeForCents":null}"""))
        assertEquals(StopPayment("CARD", 4590, null), payment("""{"method":"CARD","amountDueCents":4590,"changeForCents":2000}"""))
        assertNull("no payment on older orders", payment("null"))
        assertNull("a card without the amount is not guessed", payment("""{"method":"CARD","amountDueCents":null}"""))
        assertNull("unknown method", payment("""{"method":"BOLETO","amountDueCents":100}"""))
    }
}
