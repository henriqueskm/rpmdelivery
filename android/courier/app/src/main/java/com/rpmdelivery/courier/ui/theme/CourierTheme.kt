package com.rpmdelivery.courier.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Ink = Color(0xFF202C25)
val Coral = Color(0xFFBD401B)
val SoftCoral = Color(0xFFFFEEE7)
val Green = Color(0xFF096B36)
val SoftGreen = Color(0xFFE5F3EB)

private val CourierColors = lightColorScheme(
    primary = Coral,
    onPrimary = Color.White,
    primaryContainer = SoftCoral,
    onPrimaryContainer = Ink,
    secondary = Green,
    onSecondary = Color.White,
    secondaryContainer = SoftGreen,
    onSecondaryContainer = Green,
    background = Color(0xFFF8F8F4),
    onBackground = Ink,
    surface = Color.White,
    onSurface = Ink,
    surfaceVariant = Color(0xFFF3F5F1),
    onSurfaceVariant = Color(0xFF58645C),
    outline = Color(0xFF727E74),
    outlineVariant = Color(0xFFDCE1D9),
    error = Color(0xFFAA251B),
)

@Composable
fun CourierTheme(content: @Composable () -> Unit) {
    // Fixed approved identity; no downloaded font, dynamic recoloring or animation.
    MaterialTheme(colorScheme = CourierColors, typography = Typography(), content = content)
}
