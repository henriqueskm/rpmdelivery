package com.rpmdelivery.courier

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.AnnotatedString
import com.rpmdelivery.courier.ui.CourierDemoApp
import com.rpmdelivery.courier.ui.DemoScreen
import com.rpmdelivery.courier.ui.theme.CourierTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.annotation.LooperMode

/** Actual Compose rendering in Robolectric. Not an emulator or physical device. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "pt-rBR-w390dp-h844dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@LooperMode(LooperMode.Mode.PAUSED)
class CourierScreensTest {
    @get:Rule val compose = createComposeRule()

    private fun show(screen: DemoScreen) {
        compose.setContent { CourierTheme { CourierDemoApp(screen) } }
    }

    private fun capture(name: String) {
        captureEvidence(compose, name)
    }

    @Test fun welcomeShowsBrandDemoAndAccessiblePaths() {
        show(DemoScreen.Welcome)
        compose.onNodeWithText("RpmDelivery").assertIsDisplayed()
        capture("01-welcome-390")
        compose.onNodeWithText("Entrar").assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithText("Bom ter você aqui.").assertIsDisplayed()
        compose.onNodeWithText("Voltar").performClick()
        compose.onNodeWithText("Conhecer Minha rota").performScrollTo().performClick()
        compose.onNodeWithText("Pedido #1042").assertIsDisplayed()
    }

    @Test fun loginValidatesAndOnlyNavigatesLocally() {
        show(DemoScreen.Login)
        capture("02-login-390")
        compose.onNodeWithText("Entrar na demonstração").performScrollTo().performClick()
        compose.onNodeWithText("Digite um e-mail fictício válido.").assertIsDisplayed()
        compose.onNodeWithText("E-mail fictício").performTextInput("motoboy@example.invalid")
        compose.onNodeWithText("Senha fictícia").performTextInput("ficticia123")
        compose.onNodeWithContentDescription("Mostrar senha").assertHasClickAction().performClick()
        compose.onNodeWithContentDescription("Ocultar senha").assertHasClickAction()
        compose.onNodeWithText("Entrar na demonstração").performScrollTo().performClick()
        compose.onNodeWithText("Pedido 2 de 4").assertIsDisplayed()
        compose.onNodeWithText("Início").performClick()
        compose.onNodeWithText("Entrar").performClick()
        // Leaving the form disposes the fields; no fake authenticated session.
        compose.onNodeWithText("E-mail fictício").assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")))
    }

    @Test fun registrationCanBeCompletedWithoutCreatingAnAccount() {
        show(DemoScreen.Registration)
        capture("03-registration-390")
        compose.onNodeWithText("Concluir cadastro demonstrativo").performScrollTo().performClick()
        compose.onNodeWithText("Nome completo fictício").performScrollTo().performTextInput("Pessoa de teste")
        compose.onNodeWithText("E-mail fictício").performScrollTo().performTextInput("motoboy@example.invalid")
        compose.onNodeWithText("Senha fictícia").performScrollTo().performTextInput("ficticia123")
        compose.onNodeWithText("Modelo da moto").performScrollTo().performTextInput("fan 160")
        compose.onNodeWithText("Honda CG 160 Fan").performScrollTo().assertHeightIsAtLeast(48.dp).performClick()
        compose.onNodeWithText("Placa fictícia").performScrollTo().performTextInput("abc1d23")
        compose.onNodeWithText("Cor da moto").performScrollTo().performTextInput("Preta")
        capture("03-registration-motorcycle-390")
        compose.onNodeWithText("Concluir cadastro demonstrativo").performScrollTo().performClick()
        compose.onNodeWithText("Este foi apenas um exemplo de cadastro. Nenhuma conta foi criada e os dados não foram enviados ou salvos.").assertIsDisplayed()
        compose.onNodeWithText("Ver minha rota").performClick()
        compose.onNodeWithText("Pedido #1042").assertIsDisplayed()
    }

    @Test fun routeActionsExplainTheDemoWithoutMutatingDelivery() {
        show(DemoScreen.Route)
        compose.onNodeWithText("Em rota").assertIsDisplayed()
        compose.onNodeWithText("Rua das Flores, 125").assertIsDisplayed()
        capture("04-route-390")
        for (action in listOf("Abrir navegação", "ENTREGA CONCLUÍDA", "Não consegui entregar")) {
            compose.onNodeWithText(action).performScrollTo().assertHasClickAction().assertHeightIsAtLeast(48.dp).performClick()
            compose.onNodeWithText("Você está em uma demonstração").assertIsDisplayed()
            compose.onNodeWithText("Entendi").performClick()
            compose.onNodeWithText("Pedido #1042").assertIsDisplayed()
            compose.onNodeWithText("Pedido 2 de 4").assertIsDisplayed()
        }
    }
}
