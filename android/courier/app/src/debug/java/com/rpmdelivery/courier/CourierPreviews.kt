package com.rpmdelivery.courier

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import com.rpmdelivery.courier.ui.CourierDemoApp
import com.rpmdelivery.courier.ui.DemoScreen
import com.rpmdelivery.courier.ui.theme.CourierTheme

@Preview(name = "01 · Boas-vindas", widthDp = 390, heightDp = 844, showBackground = true, locale = "pt-rBR")
@Composable
private fun WelcomePreview() = CourierTheme { CourierDemoApp(DemoScreen.Welcome) }

@Preview(name = "02 · Login", widthDp = 390, heightDp = 844, showBackground = true, locale = "pt-rBR")
@Composable
private fun LoginPreview() = CourierTheme { CourierDemoApp(DemoScreen.Login) }

@Preview(name = "03 · Cadastro", widthDp = 390, heightDp = 1200, showBackground = true, locale = "pt-rBR")
@Composable
private fun RegistrationPreview() = CourierTheme { CourierDemoApp(DemoScreen.Registration) }

@Preview(name = "04 · Minha rota", widthDp = 390, heightDp = 844, showBackground = true, locale = "pt-rBR")
@Preview(name = "Minha rota · 320dp · fonte 150%", widthDp = 320, heightDp = 640, fontScale = 1.5f, showBackground = true, locale = "pt-rBR")
@Composable
private fun RoutePreview() = CourierTheme { CourierDemoApp(DemoScreen.Route) }
