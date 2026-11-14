package com.rpmdelivery.courier.work

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
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

    private fun show() {
        controller = AuthController(auth, scope)
        // Long interval: the test drives each read, no timer fires during it.
        work = WorkController(fake, scope, onExpired = { controller.sessionExpired() }, refreshMillis = 3_600_000)
        compose.setContent { CourierTheme { CourierApp(controller, work) } }
        compose.runOnIdle { controller.restore() }
    }
    private fun reload() { compose.runOnIdle { work.refresh() }; compose.waitForIdle() }
    private fun node(text: String) = compose.onNodeWithText(text).performScrollTo()

    @Test fun courierAsksForShiftWaitsInLineRunsTheRouteAndComesBack() {
        show()
        node("Pronto para começar?").assertIsDisplayed()
        captureEvidence(compose, "work-01-stores-390")
        node("Cheguei · pedir turno").assertHeightIsAtLeast(48.dp).performClick()
        node("Aguardando a loja").assertIsDisplayed()
        node("Cancelar pedido de turno").assertIsDisplayed()

        fake.approve(); reload()
        node("1º").assertIsDisplayed()
        node("Você é o próximo da fila").assertIsDisplayed()
        compose.onNodeWithText("Turno pedido em Cozinha da Vila. Aguarde a loja aprovar.").assertDoesNotExist()
        captureEvidence(compose, "work-02-queue-390")

        fake.assign(); reload()
        node("Rota em preparação").assertIsDisplayed()
        node("A loja está separando os pedidos. Aguarde a liberação da retirada.").assertIsDisplayed()
        compose.onNodeWithText("Iniciar rota").assertDoesNotExist()

        fake.release(); reload()
        captureEvidence(compose, "work-03-released-390")
        node("Iniciar rota").performClick()
        node("Minha rota").assertIsDisplayed()
        node("Entrega 1 de 2").assertIsDisplayed()
        compose.onAllNodesWithText("Helena Prado").onFirst().performScrollTo().assertIsDisplayed()
        node("Pedido #1048").assertIsDisplayed()
        node("Observação: Portão azul, tocar duas vezes").assertIsDisplayed()
        assertTrue(fake.calls.contains("start_route:2"))
        assertEquals(1, fake.notified)
        captureEvidence(compose, "work-04-next-stop-390")

        // Delivered needs a confirmation: a stray tap does nothing.
        node("ENTREGA CONCLUÍDA").assertHeightIsAtLeast(56.dp).performClick()
        compose.onNodeWithText("Confirmar entrega?").assertIsDisplayed()
        compose.onNodeWithText("Voltar").performClick()
        assertFalse(fake.calls.any { it.startsWith("complete_delivery") })
        node("ENTREGA CONCLUÍDA").performClick()
        compose.onNodeWithText("Confirmar entrega").performClick()
        node("Entrega 2 de 2").assertIsDisplayed()
        compose.onAllNodesWithText("Igor Nunes").onFirst().performScrollTo().assertIsDisplayed()

        // A failure needs a reason, and a written report for "Outro motivo".
        node("Não consegui entregar").performClick()
        compose.onNodeWithText("Enviar para a loja").assertIsNotEnabled()
        compose.onNodeWithText("Outro motivo").performClick()
        compose.onNodeWithText("Enviar para a loja").assertIsNotEnabled()
        compose.onNodeWithText("O que aconteceu? (obrigatório)").performTextInput("Portão fechado")
        captureEvidence(compose, "work-05-failure-390")
        compose.onNodeWithText("Enviar para a loja").assertIsEnabled().performClick()
        assertTrue(fake.calls.contains("report_delivery_failure:d-2:OTHER:Portão fechado"))

        node("Volte para a loja").assertIsDisplayed()
        node("1 entregue · 1 para devolver na loja").assertIsDisplayed()
        captureEvidence(compose, "work-06-returning-390")
        node("Cheguei na loja").performClick()
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

    @Test fun expiredSessionReturnsToLoginWithoutTheRoute() {
        show()
        fake.failOnce("home", WorkProblem.expired())
        reload()
        assertEquals(AuthScreen.Login, controller.state.value.screen)
        compose.onNodeWithText(AuthCopy.EXPIRED).assertIsDisplayed()
        compose.onNodeWithText("Pronto para começar?").assertDoesNotExist()
    }
}
