package com.rpmdelivery.courier.auth

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
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
class AuthScreensTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val fake = FakeAuth()
    private lateinit var controller: AuthController
    @After fun cleanup() { scope.cancel() }
    private fun show(profile: CourierRegistration? = null) {
        fake.current = profile
        controller = AuthController(fake, scope)
        compose.setContent { CourierTheme { CourierApp(controller) } }
        compose.runOnIdle { controller.restore() }
    }
    private fun field(label: String) = compose.onNodeWithText(label).performScrollTo()

    @Test fun signupShowsPendingConfirmationThenLoginWithoutPretendingDemoRouteIsAuthorized() {
        show()
        field("Criar cadastro de motoboy").performClick()
        field("Nome completo").performTextInput("Pessoa sintética")
        field("E-mail").performTextInput("synthetic@example.invalid")
        field("Senha").performTextInput("synthetic-pass")
        captureEvidence(compose, "auth-01-account-390")
        field("Criar minha conta").assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithText(AuthCopy.CONFIRM).assertIsDisplayed()
        captureEvidence(compose, "auth-02-confirm-email-390")
        field("Já confirmei · Entrar").performClick()
        field("E-mail").performTextInput("synthetic@example.invalid")
        field("Senha").performTextInput("synthetic-pass")
        field("Entrar na minha conta").performClick()
        compose.onNodeWithText("Cadastro de motoboy concluído").assertIsDisplayed()
        compose.onNodeWithText("Pedido #1042").assertDoesNotExist()
        captureEvidence(compose, "auth-03-home-390")
        field("Conhecer Minha rota · demonstração").performClick()
        compose.onNodeWithText("DEMONSTRAÇÃO").assertIsDisplayed()
        compose.onNodeWithText("Pedido #1042").assertIsDisplayed()
        field("Início").performClick(); field("Sair").performClick()
        compose.onNodeWithText("RpmDelivery").assertIsDisplayed()
        assertFalse(controller.state.value.authenticated)
    }
    @Test fun legacyModelOutsideCatalogIsPreservedWhileOnlyMissingColorIsRequested() {
        show(completeProfile.copy(model = "Moto antiga válida fora do catálogo", color = ""))
        field("Moto antiga válida fora do catálogo").assertIsDisplayed()
        compose.onNodeWithText("Modelo da moto").assert(hasNoClickAction())
        compose.onNodeWithText("Placa").assert(hasNoClickAction())
        field("Cor da moto").performTextInput("Vermelha")
        captureEvidence(compose, "auth-04-legacy-profile-390")
        field("Concluir cadastro de motoboy").performClick()
        compose.onNodeWithText("Cadastro de motoboy concluído").assertIsDisplayed()
        assertEquals("Moto antiga válida fora do catálogo", controller.state.value.registration.model)
        assertEquals("Vermelha", controller.state.value.registration.color)
    }
    @Test fun unavailableMotorcycleCanRemainPendingWithoutSubmittingWrongData() {
        show(CourierRegistration(name = "Pessoa sintética"))
        field("Modelo da moto").performTextInput("modelo inexistente")
        field("Não encontrei minha moto").performClick()
        field("Sua conta já está criada. Não escolha outro modelo. Você pode deixar o cadastro pendente e voltar quando sua moto estiver disponível no catálogo.").assertIsDisplayed()
        captureEvidence(compose, "auth-05-model-unavailable-390")
        field("Completar depois").performClick()
        compose.onNodeWithText("Conta criada · cadastro pendente").assertIsDisplayed()
        assertEquals(0, fake.completions)
        compose.onNodeWithText("Pedido #1042").assertDoesNotExist()
    }
    @Test fun unconfirmedEmailErrorKeepsLoginAccessibleAndDoesNotExposeInternalErrors() {
        show(); fake.loginFailure = AuthProblem("Confirme seu e-mail antes de entrar. Abra a mensagem enviada para sua conta.")
        field("Entrar").performClick()
        captureEvidence(compose, "auth-06-login-390")
        field("E-mail").performTextInput("synthetic@example.invalid")
        field("Senha").performTextInput("synthetic-pass")
        field("Entrar na minha conta").performClick()
        field("Confirme seu e-mail antes de entrar. Abra a mensagem enviada para sua conta.").assertIsDisplayed()
        compose.onNodeWithText("Digite sua senha.").assertDoesNotExist()
        compose.onNodeWithText("Senha").assert(SemanticsMatcher.expectValue(
            androidx.compose.ui.semantics.SemanticsProperties.EditableText, androidx.compose.ui.text.AnnotatedString("")))
        captureEvidence(compose, "auth-07-unconfirmed-390")
    }
    @Test fun failedCompletionShowsFeedbackEvenAfterSubmittingBelowTheFold() {
        show(completeProfile.copy(
            name = "Ana Carolina de Albuquerque Vasconcelos de Oliveira e Silva de Andrade · Pessoa sintética",
            model = "Yamaha XTZ 250 Lander ABS Connected · edição especial de cadastro anterior",
            color = "",
        ))
        fake.completionFailure = AuthProblem(AuthCopy.NETWORK)
        field("Cor da moto").performTextInput("Preta")
        field("Concluir cadastro de motoboy").performClick()
        captureEvidence(compose, "auth-11-save-error-390")
        val bounds = compose.onNodeWithText(AuthCopy.NETWORK).getUnclippedBoundsInRoot()
        assertTrue("Failure feedback must be fully visible", bounds.top >= 0.dp && bounds.bottom <= 844.dp)
        field("Cor da moto").assertTextContains("Preta")
        compose.onNodeWithText("Cadastro de motoboy concluído").assertDoesNotExist()
    }
}
