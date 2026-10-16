package com.rpmdelivery.courier

import android.text.InputType
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.InterceptPlatformTextInput
import androidx.compose.ui.platform.PlatformTextInputInterceptor
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.TextRange
import com.rpmdelivery.courier.ui.components.DemoTextField
import com.rpmdelivery.courier.ui.components.RegistrationPhoneField
import com.rpmdelivery.courier.ui.theme.CourierTheme
import kotlinx.coroutines.awaitCancellation
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
@OptIn(ExperimentalTestApi::class, ExperimentalComposeUiApi::class)
class PhoneInputTest {
    @get:Rule val compose = createComposeRule()
    private val state = TextFieldState()
    private var editor: EditorInfo? = null
    private var connection: InputConnection? = null

    private fun show() {
        val interceptor = PlatformTextInputInterceptor { request, _ ->
            val info = EditorInfo()
            connection = request.createInputConnection(info)
            editor = info
            awaitCancellation() // Test IME, not a claim of hardware keyboard coverage.
        }
        compose.setContent {
            InterceptPlatformTextInput(interceptor) {
                CourierTheme {
                    Column {
                        RegistrationPhoneField(state, false)
                        DemoTextField("Próximo campo", "", {}, last = true)
                    }
                }
            }
        }
    }

    private fun phone() = compose.onNodeWithText("Celular com DDD (opcional)")
    private fun expect(text: String, cursor: Int? = null) = compose.runOnIdle {
        assertEquals(text, state.text.toString())
        if (cursor != null) assertEquals(TextRange(cursor), state.selection)
    }

    @Test fun formattedPasteUsesPhoneImeAndRejectsOverflowWithoutLosingDigits() {
        show()
        phone().performClick()
        compose.waitUntil { connection != null }
        compose.runOnIdle {
            assertEquals(InputType.TYPE_CLASS_PHONE, editor!!.inputType and InputType.TYPE_MASK_CLASS)
            assertEquals(EditorInfo.IME_ACTION_NEXT, editor!!.imeOptions and EditorInfo.IME_MASK_ACTION)
            assertTrue(connection!!.commitText("+55 (11) 98765-4321", 1))
        }
        expect("11987654321", 11)
        phone().assertTextContains("(11) 98765-4321")
        phone().performTextInput("9")
        expect("11987654321", 11)
        phone().performTextReplacement("+1 202 555 1234")
        expect("11987654321")
        phone().performTextReplacement("(55) 98765-4321")
        expect("55987654321", 11)
        phone().performTextReplacement("55999999999")
        phone().performTextInput("9")
        expect("55999999999", 11)
        phone().performTextInput("99")
        expect("55999999999", 11)
        phone().performTextReplacement("+5511987654321")
        expect("11987654321", 11)
    }

    @Test fun replacingAndDeletingInTheMiddlePreserveTheCursorAcrossMaskBoundaries() {
        show()
        phone().performTextInput("11987654321")
        phone().performTextInputSelection(TextRange(4, 5))
        phone().performTextInput("0")
        expect("11980654321", 5)
        phone().performKeyInput { pressKey(Key.Backspace) }
        expect("1198654321", 4)
        phone().performTextInput("7")
        expect("11987654321", 5)
        phone().performTextInputSelection(TextRange(2))
        phone().performKeyInput { pressKey(Key.Backspace) }
        expect("1987654321", 1)
        phone().performTextInput("1")
        expect("11987654321", 2)
        phone().performTextInputSelection(TextRange(7))
        phone().performKeyInput { pressKey(Key.Backspace) }
        expect("1198764321", 6)
        phone().performTextInput("5")
        expect("11987654321", 7)
        phone().performTextInputSelection(TextRange(0, 11))
        phone().performKeyInput { pressKey(Key.Backspace) }
        expect("", 0)
    }

    @Test fun imeNextMovesFocusToTheFollowingField() {
        show()
        phone().performTextInput("11987654321")
        phone().performImeAction()
        compose.onNodeWithText("Próximo campo").assertIsFocused()
    }
}
