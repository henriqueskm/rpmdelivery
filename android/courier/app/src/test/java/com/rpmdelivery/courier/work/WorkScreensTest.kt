package com.rpmdelivery.courier.work

import android.Manifest
import android.app.Application
import androidx.compose.ui.test.*
import androidx.test.core.app.ApplicationProvider
import com.rpmdelivery.courier.shift.ShiftService
import org.robolectric.Shadows.shadowOf
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.unit.dp
import com.rpmdelivery.courier.auth.AuthController
import com.rpmdelivery.courier.auth.AuthCopy
import com.rpmdelivery.courier.auth.AuthScreen
import com.rpmdelivery.courier.auth.FakeAuth
import com.rpmdelivery.courier.auth.completeProfile
import com.rpmdelivery.courier.captureEvidence
import com.rpmdelivery.courier.ui.CourierApp
import com.rpmdelivery.courier.ui.theme.CourierTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "pt-rBR-w390dp-h844dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WorkScreensTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val fake = FakeWork()
    private val auth = FakeAuth().apply { current = completeProfile }
    private lateinit var controller: AuthController
    private lateinit var work: WorkController
    @After fun cleanup() { scope.cancel() }

    private val app: Application get() = ApplicationProvider.getApplicationContext()
    private fun show(grant: Boolean = true) {
        // Robolectric never answers a permission dialog: the flows run as if the courier had allowed them.
        if (grant) shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS,
            Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        controller = AuthController(auth, scope)
        // Long interval: the test drives each read, no timer fires during it.
        work = WorkController(fake, scope, onExpired = { controller.sessionExpired() }, refreshMillis = 3_600_000)
        compose.setContent { CourierTheme { CourierApp(controller, work) } }
        compose.runOnIdle { controller.restore() }
    }
    private fun reload() { compose.runOnIdle { work.refresh() }; compose.waitForIdle() }
    private fun node(text: String) = compose.onNodeWithText(text).performScrollTo()
    /** Drags the thumb from its resting place to [share] of the track width. */
    private fun swipe(label: String, share: Float = 1f) {
        node(label).performTouchInput { swipeRight(startX = left + 32f, endX = left + (width - 1) * share, durationMillis = 400) }
        compose.waitForIdle()
    }

    @Test fun courierAsksForShiftWaitsInLineRunsTheRouteAndComesBack() {
        show()
        node("Pronto para começar?").assertIsDisplayed()
        captureEvidence(compose, "work-01-stores-390")
        assertNull("no shift, no service", shadowOf(app).peekNextStartedService())
        node("Cheguei · pedir turno").assertHeightIsAtLeast(48.dp).performClick()
        node("Aguardando a loja").assertIsDisplayed()
        node("Cancelar pedido de turno").assertIsDisplayed()
        // An open shift starts the shift service, which rings when the store answers.
        assertEquals(ShiftService::class.java.name, shadowOf(app).nextStartedService.component!!.className)

        fake.approve(); reload()
        node("1º").assertIsDisplayed()
        node("Você é o próximo da fila").assertIsDisplayed()
        compose.onNodeWithText("Turno pedido em Cozinha da Vila. Aguarde a loja aprovar.").assertDoesNotExist()
        captureEvidence(compose, "work-02-queue-390")

        fake.assign(); reload()
        node("Rota em preparação").assertIsDisplayed()
        node("A loja está separando os pedidos. Aguarde a liberação da retirada.").assertIsDisplayed()
        compose.onNodeWithText("Deslize para iniciar a rota").assertDoesNotExist()

        fake.release(); reload()
        captureEvidence(compose, "work-03-released-390")
        // Starting cannot be undone: a tap does nothing, the swipe starts.
        node("Deslize para iniciar a rota").assertHeightIsAtLeast(64.dp).performClick()
        assertFalse(fake.calls.any { it.startsWith("start_route") })
        swipe("Deslize para iniciar a rota")
        node("Minha rota").assertIsDisplayed()
        node("Entrega 1 de 2").assertIsDisplayed()
        compose.onAllNodesWithText("Helena Prado").onFirst().performScrollTo().assertIsDisplayed()
        node("Pedido #1048").assertIsDisplayed()
        node("Observação: Portão azul, tocar duas vezes").assertIsDisplayed()
        assertTrue(fake.calls.contains("start_route:2"))
        assertEquals(1, fake.notified)
        captureEvidence(compose, "work-04-next-stop-390")

        // Delivered: a stray tap or a swipe let go halfway does nothing; the full swipe delivers.
        node("Deslize para confirmar a entrega").performClick()
        swipe("Deslize para confirmar a entrega", share = 0.5f)
        assertFalse(fake.calls.any { it.startsWith("complete_delivery") })
        node("Entrega 1 de 2").assertIsDisplayed()
        swipe("Deslize para confirmar a entrega")
        assertTrue(fake.calls.contains("complete_delivery:d-1"))
        node("Entrega 2 de 2").assertIsDisplayed()
        compose.onAllNodesWithText("Igor Nunes").onFirst().performScrollTo().assertIsDisplayed()

        // A failure needs a reason, and a written report for "Outro motivo".
        node("Não consegui entregar").performClick()
        compose.onNodeWithText("Deslize para confirmar a entrega").assertDoesNotExist()
        node("Enviar para a loja").assertIsNotEnabled()
        node("Voltar").performClick()
        node("Não consegui entregar").performClick()
        node("Outro motivo").performClick()
        node("Enviar para a loja").assertIsNotEnabled()
        node("O que aconteceu? (obrigatório)").performTextInput("Portão fechado")
        captureEvidence(compose, "work-05-failure-390")
        node("Enviar para a loja").assertIsEnabled().performClick()
        assertTrue(fake.calls.contains("report_delivery_failure:d-2:OTHER:Portão fechado"))

        node("Volte para a loja").assertIsDisplayed()
        node("1 entregue · 1 para devolver na loja").assertIsDisplayed()
        captureEvidence(compose, "work-06-returning-390")
        // TalkBack cannot swipe: its double tap runs the control's click action.
        node("Deslize quando chegar na loja").assert(hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
        node("Você está na fila").assertIsDisplayed()
        node("2º").assertIsDisplayed()
        node("Chegada registrada. Você voltou para a fila.").assertIsDisplayed()

        // Ending the shift is a quiet link that asks first: a stray tap keeps the courier in line.
        node("Encerrar turno").assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithText("Encerrar o turno?").assertIsDisplayed()
        captureEvidence(compose, "work-09-end-shift-390")
        compose.onNodeWithText("Continuar na fila").performClick()
        assertFalse(fake.calls.contains("end_shift"))
        node("Você está na fila").assertIsDisplayed()
        node("Encerrar turno").performClick()
        compose.onNodeWithText("Sim, encerrar").performClick()
        node("Pronto para começar?").assertIsDisplayed()
    }

    @Test fun storeRefusalIsReadableAndNoStoreExplainsTheInvite() {
        fake.home = fake.home.copy(stores = listOf(Store("r-2", "Pizzaria Sintética", "PENDING")))
        show()
        node("Nenhuma loja aprovada").assertIsDisplayed()
        node("Aguardando a loja Pizzaria Sintética aprovar seu vínculo.").assertIsDisplayed()
        fake.home = fake.home.copy(stores = listOf(fake.store))
        fake.failOnce("request_shift", WorkProblem.refused("RPM_SHIFT_OPEN_ELSEWHERE"))
        reload()
        node("Cheguei · pedir turno").performClick()
        node(WorkCopy.forCode("RPM_SHIFT_OPEN_ELSEWHERE")).assertIsDisplayed()
    }

    @Test fun earningsButtonStaysInTheCornerAndOpensTheHistory() {
        fake.home = fake.home.copy(today = Today(3, 3000, 2100, 5100))
        show()
        // Off duty: the top line has the symbol and "Sair", and no earnings to follow.
        val pill = compose.onNodeWithContentDescription("A receber hoje: R$ 51,00, 3 entregas. Abrir histórico")
        pill.assertDoesNotExist()
        compose.onNodeWithContentDescription("RpmDelivery").assertIsDisplayed()
        compose.onNodeWithText("Sair").assertIsDisplayed()
        compose.onNodeWithText("Início").assertDoesNotExist()
        compose.onNodeWithText("RpmDelivery").assertDoesNotExist()

        // On shift the earnings sit in the middle of the fixed top line.
        fake.home = fake.home.copy(shift = Shift("shift-1", "r-1", "Cozinha da Vila", "AVAILABLE", 1))
        reload()
        pill.assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        assertFalse("past days are read only when the history opens", fake.calls.contains("history"))
        captureEvidence(compose, "work-11-today-390")
        pill.performClick()
        node("Histórico").assertIsDisplayed()
        node("R$ 116,00").assertIsDisplayed()
        node("8 entregas em 30 dias").assertIsDisplayed()
        node("sáb., 14/11 · Cozinha da Vila").assertIsDisplayed()
        node("3 entregas · encosta R$ 30,00 · entregas R$ 21,00").assertIsDisplayed()
        assertTrue(fake.calls.contains("history"))
        captureEvidence(compose, "work-12-history-390")
        compose.onNodeWithContentDescription("A receber hoje: R$ 51,00, 3 entregas. Abrir histórico").assertDoesNotExist()
        node("Voltar").performClick()
        node("Você está na fila").assertIsDisplayed()

        // An empty month says so.
        fake.historyDays = emptyList()
        compose.onNodeWithContentDescription("A receber hoje: R$ 51,00, 3 entregas. Abrir histórico").performClick()
        node("Nenhum ganho nos últimos 30 dias.").assertIsDisplayed()
        node("Voltar").performClick()

        // On the route it is still there.
        fake.home = fake.home.copy(today = Today(4, 3000, 2800, 5800),
            shift = Shift("shift-1", "r-1", "Cozinha da Vila", "ON_ROUTE", null))
        fake.assign()
        fake.home = fake.home.copy(route = fake.home.route!!.copy(status = "ON_ROUTE", pickupReleased = true, nextDeliveryId = "d-1",
            stops = fake.home.route!!.stops.mapIndexed { i, stop -> stop.copy(status = if (i == 0) "NEXT" else "ON_ROUTE") }))
        reload()
        node("Minha rota").assertIsDisplayed()
        compose.onNodeWithContentDescription("A receber hoje: R$ 58,00, 4 entregas. Abrir histórico").assertIsDisplayed()
        captureEvidence(compose, "work-13-route-with-earnings-390")
    }

    @Test fun routeWithoutLocationGoesOnAndSaysTheCustomerCannotSeeTheCourier() {
        fake.home = fake.home.copy(shift = Shift("shift-1", "r-1", "Cozinha da Vila", "ON_ROUTE", null))
        fake.assign()
        fake.home = fake.home.copy(route = fake.home.route!!.copy(status = "ON_ROUTE", pickupReleased = true, nextDeliveryId = "d-1",
            stops = fake.home.route!!.stops.mapIndexed { i, stop -> stop.copy(status = if (i == 0) "NEXT" else "ON_ROUTE") }))
        show(grant = false)
        node("Localização desligada: o cliente que é o próximo não vê você no mapa.").assertIsDisplayed()
        node("Permitir localização").assertHeightIsAtLeast(48.dp)
        node("Deslize para confirmar a entrega").assertIsDisplayed()
        captureEvidence(compose, "work-10-location-off-390")
    }

    @Test fun expiredSessionReturnsToLoginWithoutTheRoute() {
        show()
        fake.failOnce("home", WorkProblem.expired())
        reload()
        assertEquals(AuthScreen.Login, controller.state.value.screen)
        compose.onNodeWithText(AuthCopy.EXPIRED).assertIsDisplayed()
        compose.onNodeWithText("Pronto para começar?").assertDoesNotExist()
    }
}
