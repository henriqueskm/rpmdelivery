package com.rpmdelivery.courier

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import com.rpmdelivery.courier.ui.CourierDemoApp
import com.rpmdelivery.courier.ui.DemoScreen
import com.rpmdelivery.courier.ui.theme.CourierTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "pt-rBR-w320dp-h640dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class CompactRegistrationTest {
    @get:Rule val compose = createComposeRule()

    private fun imeInset(bottom: Int) {
        compose.runOnIdle {
            val root = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).single().window.decorView
            val insets = WindowInsetsCompat.Builder()
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, bottom))
                .setVisible(WindowInsetsCompat.Type.ime(), bottom > 0).build()
            ViewCompat.dispatchApplyWindowInsets(root, insets)
        }
        compose.waitForIdle()
    }

    @Test fun largeFontAndSimulatedImeInsetsKeepPhoneAndEverySuggestionReachable() {
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(1f, 1.5f)) {
                CourierTheme { CourierDemoApp(DemoScreen.Registration) }
            }
        }
        imeInset(280) // Synthetic inset; no software keyboard is painted by Robolectric.
        compose.onNodeWithText("Celular com DDD (opcional)").performScrollTo().performTextInput("+55 (11) 98765-4321")
        compose.onNodeWithText("Celular com DDD (opcional)").assertTextContains("(11) 98765-4321")
        captureEvidence(compose, "09-registration-phone-320-font150-ime-insets")
        compose.onNodeWithText("Modelo da moto").performScrollTo().performTextInput("yamaha")
        for (name in listOf("Yamaha Factor 125", "Yamaha Factor 150", "Yamaha Fazer FZ15", "Yamaha Fazer FZ25")) {
            val node = compose.onNode(motorcycleButton(name)).performScrollTo().assertIsDisplayed().assertHeightIsAtLeast(48.dp)
            val bounds = node.getUnclippedBoundsInRoot()
            assertTrue("Horizontal overflow: $name", bounds.left >= 0.dp && bounds.right <= 320.dp)
            assertTrue("Action behind simulated IME: $name", bounds.bottom <= 360.dp)
        }
        captureEvidence(compose, "10-registration-suggestions-320-font150-ime-insets")
        compose.onNodeWithText("Não encontrei minha moto").performScrollTo().assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        compose.onNode(motorcycleButton("Yamaha Factor 125")).performScrollTo().performClick()
        imeInset(0)
        compose.onNodeWithText("Modelo selecionado").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Concluir cadastro demonstrativo").performScrollTo().assertIsDisplayed().assertHeightIsAtLeast(48.dp)
    }
}
