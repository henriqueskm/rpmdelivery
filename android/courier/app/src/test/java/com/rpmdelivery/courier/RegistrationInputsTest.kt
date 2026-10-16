package com.rpmdelivery.courier

import androidx.compose.runtime.SideEffect
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.InputModeManager
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.rpmdelivery.courier.ui.CourierDemoApp
import com.rpmdelivery.courier.ui.DemoScreen
import com.rpmdelivery.courier.ui.theme.CourierTheme
import org.junit.Rule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

internal fun motorcycleButton(name: String) = hasText(name) and SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button)

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "pt-rBR-w390dp-h844dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@OptIn(ExperimentalTestApi::class)
class RegistrationInputsTest {
    @get:Rule val compose = createComposeRule()
    private var inputMode: InputModeManager? = null

    private fun show() {
        compose.setContent {
            val mode = LocalInputModeManager.current
            SideEffect { inputMode = mode }
            CourierTheme { CourierDemoApp(DemoScreen.Registration) }
        }
    }
    private fun field(label: String) = compose.onNodeWithText(label).performScrollTo()
    private fun submit() { field("Concluir cadastro demonstrativo").performClick() }
    private fun fillOtherFields() {
        field("Nome completo fictício").performTextInput("Pessoa de teste")
        field("E-mail fictício").performTextInput("motoboy@example.invalid")
        field("Senha fictícia").performTextInput("ficticia123")
        field("Placa fictícia").performTextInput("abc1d23")
        field("Cor da moto").performTextInput("Preta")
    }
    private fun choose(name: String) { compose.onNode(motorcycleButton(name)).performScrollTo().assertHeightIsAtLeast(48.dp).performClick() }
    private fun completed() { compose.onNodeWithText("Você está em uma demonstração").assertIsDisplayed() }
    private fun notCompleted() { compose.onNodeWithText("Você está em uma demonstração").assertDoesNotExist() }

    @Test fun incompletePhoneBlocksCompletionAndValidPastedPhoneUnblocksIt() {
        show(); fillOtherFields()
        field("Modelo da moto").performTextInput("fan 160"); choose("Honda CG 160 Fan")
        field("Celular com DDD (opcional)").performTextInput("11987")
        submit(); notCompleted()
        field("Informe um DDD válido e 9 dígitos de celular, começando por 9, ou deixe vazio.").assertIsDisplayed()
        field("Celular com DDD (opcional)").performTextReplacement("+55 (11) 98765-4321")
        captureEvidence(compose, "06-registration-phone-390")
        submit(); completed()
    }

    @Test fun exactTypedNameAndEditingAnExistingSelectionCannotBypassThePicker() {
        show(); fillOtherFields()
        field("Modelo da moto").performTextInput("Honda CG 160 Fan")
        submit(); notCompleted()
        field("Selecione uma moto da lista para continuar.").assertIsDisplayed()
        field("Modelo da moto").performClick(); choose("Honda CG 160 Fan")
        field("Modelo da moto").performTextReplacement("Yamaha NMAX 160")
        submit(); notCompleted()
        field("Selecione uma moto da lista para continuar.").assertIsDisplayed()
        field("Modelo da moto").performClick(); choose("Yamaha NMAX 160")
        submit(); completed() // Empty optional phone is valid.
    }

    @Test fun missingModelIsSeparateBlockedStateAndSearchCanBeRecovered() {
        show(); fillOtherFields()
        field("Modelo da moto").performTextInput("Marca que não consta")
        field("Nenhum modelo encontrado neste catálogo inicial.").assertIsDisplayed()
        field("Não encontrei minha moto").assertHeightIsAtLeast(48.dp).performClick()
        field("Vamos precisar ampliar o catálogo").assertIsDisplayed()
        captureEvidence(compose, "08-registration-not-found-390")
        submit(); notCompleted()
        field("Voltar à busca").performClick()
        compose.onNodeWithText("Modelo da moto").assertIsFocused().performTextInput("YÁMAHA fz 15")
        compose.onNode(motorcycleButton("Yamaha Fazer FZ15")).performScrollTo().assertHeightIsAtLeast(48.dp)
        captureEvidence(compose, "07-registration-suggestions-390")
        choose("Yamaha Fazer FZ15")
        submit(); completed()
    }

    @Test fun keyboardCanReachAndSelectSuggestionsWithoutCollapsingTheList() {
        // Robolectric native graphics defaults to touch mode even for injected keys.
        InstrumentationRegistry.getInstrumentation().setInTouchMode(false)
        show()
        compose.runOnIdle {
            assertTrue(inputMode!!.requestInputMode(InputMode.Keyboard))
            assertEquals(InputMode.Keyboard, inputMode!!.inputMode)
        }
        field("Modelo da moto").performTextInput("yamaha")
        compose.onNodeWithText("Modelo da moto").performKeyInput { pressKey(Key.Tab) }
        compose.onNode(motorcycleButton("Yamaha Factor 125")).assertIsFocused().assertIsDisplayed()
        captureEvidence(compose, "11-registration-keyboard-focus-390")
        compose.onNode(motorcycleButton("Yamaha Factor 125")).performKeyInput { pressKey(Key.Enter) }
        compose.onNodeWithText("Modelo selecionado").assertExists()
        compose.onNodeWithText("Nenhum modelo encontrado neste catálogo inicial.").assertDoesNotExist()
    }
}
