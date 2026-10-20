package com.rpmdelivery.courier

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.rpmdelivery.courier.auth.CourierRegistration
import com.rpmdelivery.courier.demo.sampleDelivery
import com.rpmdelivery.courier.ui.components.DemoNotice
import com.rpmdelivery.courier.ui.screens.AccountScreen
import com.rpmdelivery.courier.ui.screens.CourierProfileScreen
import com.rpmdelivery.courier.ui.screens.RouteScreen
import com.rpmdelivery.courier.ui.screens.WelcomeScreen
import com.rpmdelivery.courier.ui.theme.CourierTheme

/** Pure previews never initialize an Auth client or execute an operation. */
@Composable private fun PreviewShell(content: @Composable () -> Unit) = CourierTheme {
    Surface { Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp)) { content() } }
}
@Preview(name = "01 · Boas-vindas", widthDp = 390, heightDp = 844, showBackground = true, locale = "pt-rBR")
@Composable private fun WelcomePreview() = PreviewShell { WelcomeScreen({}, {}, {}, realAccount = true) }

@Preview(name = "02 · Login", widthDp = 390, heightDp = 844, showBackground = true, locale = "pt-rBR")
@Composable private fun LoginPreview() = PreviewShell { AccountScreen(false, false, { _, _, _ -> }, {}) }

@Preview(name = "03 · Conta", widthDp = 390, heightDp = 844, showBackground = true, locale = "pt-rBR")
@Composable private fun AccountPreview() = PreviewShell { AccountScreen(true, false, { _, _, _ -> }, {}) }

@Preview(name = "04 · Cadastro de motoboy", widthDp = 390, heightDp = 1200, showBackground = true, locale = "pt-rBR")
@Composable private fun RegistrationPreview() = PreviewShell { CourierProfileScreen(CourierRegistration(name = "Pessoa de exemplo"), false, {}, {}) }

@Preview(name = "05 · Minha rota · demonstração", widthDp = 390, heightDp = 844, showBackground = true, locale = "pt-rBR")
@Preview(name = "Minha rota · 320dp · fonte 150%", widthDp = 320, heightDp = 640, fontScale = 1.5f, showBackground = true, locale = "pt-rBR")
@Composable private fun RoutePreview() = PreviewShell { DemoNotice(); RouteScreen(sampleDelivery, {}, {}, {}) }
