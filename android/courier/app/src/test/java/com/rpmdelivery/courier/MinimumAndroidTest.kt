package com.rpmdelivery.courier

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Minimum OS behavior, including the actual Activity and state restoration. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [26], qualifiers = "pt-rBR-w360dp-h640dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.LEGACY)
class MinimumAndroidTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun androidEightOpensDemoAndRestoresOnlyTheSelectedScreen() {
        compose.onNodeWithText("RpmDelivery").assertIsDisplayed()
        compose.onNodeWithText("Conhecer Minha rota").performScrollTo().performClick()
        compose.onNodeWithText("Pedido #1042").assertIsDisplayed()
        compose.activityRule.scenario.recreate()
        compose.onNodeWithText("Pedido #1042").assertIsDisplayed()
    }
}
