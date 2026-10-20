package com.rpmdelivery.courier.auth

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
import com.rpmdelivery.courier.captureEvidence
import com.rpmdelivery.courier.motorcycleButton
import com.rpmdelivery.courier.ui.CourierApp
import com.rpmdelivery.courier.ui.theme.CourierTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
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
class CompactAuthScreensTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    @After fun cleanup() { scope.cancel() }
    @Test fun realProfileFormKeepsPhoneAndCatalogReachableWithLargeFontAndImeInsets() {
        val repository = FakeAuth().apply { current = CourierRegistration(name = "Pessoa sintética com nome longo para testar a quebra de linha") }
        val controller = AuthController(repository, scope)
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(1f, 1.5f)) {
                CourierTheme { CourierApp(controller) }
            }
        }
        compose.runOnIdle { controller.restore() }
        compose.runOnIdle {
            val root = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).single().window.decorView
            ViewCompat.dispatchApplyWindowInsets(root, WindowInsetsCompat.Builder()
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, 280)).setVisible(WindowInsetsCompat.Type.ime(), true).build())
        }
        compose.onNodeWithText("Celular com DDD (opcional)").performScrollTo().performTextInput("+55 (11) 98765-4321")
        compose.onNodeWithText("Celular com DDD (opcional)").assertTextContains("(11) 98765-4321")
        captureEvidence(compose, "auth-08-profile-320-font150-ime")
        compose.onNodeWithText("Modelo da moto").performScrollTo().performTextInput("yamaha")
        for (name in listOf("Yamaha Factor 125", "Yamaha Factor 150", "Yamaha Fazer FZ15", "Yamaha Fazer FZ25")) {
            val item = compose.onNode(motorcycleButton(name)).performScrollTo().assertIsDisplayed().assertHeightIsAtLeast(48.dp)
            val bounds = item.getUnclippedBoundsInRoot()
            assertTrue(bounds.left >= 0.dp && bounds.right <= 320.dp && bounds.bottom <= 360.dp)
        }
        captureEvidence(compose, "auth-09-suggestions-320-font150-ime")
        compose.onNodeWithText("Completar depois").performScrollTo().assertIsDisplayed().assertHeightIsAtLeast(48.dp)
    }

    @Test
    @Config(qualifiers = "pt-rBR-w375dp-h812dp-mdpi")
    fun loginFits375WithLargeFontWithoutChangingApprovedControls() {
        val controller = AuthController(FakeAuth(), scope)
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(1f, 1.5f)) { CourierTheme { CourierApp(controller) } }
        }
        compose.runOnIdle { controller.restore(); controller.navigate(AuthScreen.Login) }
        compose.onNodeWithText("Entrar na minha conta").performScrollTo().assertHeightIsAtLeast(48.dp)
        captureEvidence(compose, "auth-10-login-375-font150")
        val bounds = compose.onNodeWithText("E-mail").performScrollTo().getUnclippedBoundsInRoot()
        assertTrue(bounds.left >= 0.dp && bounds.right <= 375.dp)
    }
}
