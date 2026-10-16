package com.rpmdelivery.courier

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.rpmdelivery.courier.demo.sampleDelivery
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
class CompactRouteTest {
    @get:Rule val compose = createComposeRule()

    @Test fun compactPhoneLargeFontAndLongAddressKeepActionsReachable() {
        val longAddress = "Rua das Flores e das Acácias, 125, bloco dos fundos, acesso pelo portão lateral"
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(1f, 1.5f)) {
                CourierTheme { CourierDemoApp(DemoScreen.Route, sampleDelivery.copy(street = longAddress)) }
            }
        }
        compose.onNodeWithText(longAddress).performScrollTo().assertIsDisplayed()
        captureEvidence(compose, "05-route-320-large-font-address")
        for (label in listOf("Abrir navegação", "ENTREGA CONCLUÍDA", "Não consegui entregar")) {
            val action = compose.onNodeWithText(label).performScrollTo().assertIsDisplayed().assertHeightIsAtLeast(48.dp)
            val bounds = action.getUnclippedBoundsInRoot()
            assertTrue("Action overflows the 320dp viewport: $label", bounds.left >= 0.dp && bounds.right <= 320.dp)
        }
        captureEvidence(compose, "05-route-320-large-font-actions")
    }
}
