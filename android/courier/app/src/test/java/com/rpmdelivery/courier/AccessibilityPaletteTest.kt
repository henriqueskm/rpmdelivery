package com.rpmdelivery.courier

import androidx.compose.ui.graphics.Color
import com.rpmdelivery.courier.ui.theme.Coral
import com.rpmdelivery.courier.ui.theme.Green
import com.rpmdelivery.courier.ui.theme.Ink
import com.rpmdelivery.courier.ui.theme.SoftGreen
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import org.junit.Assert.assertTrue
import org.junit.Test

class AccessibilityPaletteTest {
    private fun luminance(color: Color): Double {
        fun linear(channel: Float): Double = if (channel <= 0.04045) channel / 12.92 else ((channel + 0.055) / 1.055).pow(2.4)
        return 0.2126 * linear(color.red) + 0.7152 * linear(color.green) + 0.0722 * linear(color.blue)
    }

    @Test fun mainTextAndActionPalettesMeetNormalTextContrast() {
        for ((foreground, background) in listOf(Ink to Color.White, Color.White to Coral, Green to SoftGreen)) {
            val a = luminance(foreground)
            val b = luminance(background)
            val contrast = (max(a, b) + 0.05) / (min(a, b) + 0.05)
            assertTrue("Normal text contrast must be >= 4.5, got $contrast", contrast >= 4.5)
        }
    }
}
