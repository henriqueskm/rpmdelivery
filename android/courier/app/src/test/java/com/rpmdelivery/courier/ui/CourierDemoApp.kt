package com.rpmdelivery.courier.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.rpmdelivery.courier.R
import com.rpmdelivery.courier.demo.DemoDelivery
import com.rpmdelivery.courier.demo.sampleDelivery
import com.rpmdelivery.courier.ui.screens.LoginScreen
import com.rpmdelivery.courier.ui.screens.RegistrationScreen
import com.rpmdelivery.courier.ui.screens.RouteScreen
import com.rpmdelivery.courier.ui.screens.WelcomeScreen

enum class DemoScreen { Welcome, Login, Registration, Route }

@Composable
fun CourierDemoApp(initialScreen: DemoScreen = DemoScreen.Welcome, delivery: DemoDelivery = sampleDelivery) {
    var screen by rememberSaveable { mutableStateOf(initialScreen) }
    var message by remember { mutableStateOf<Int?>(null) }
    val scroll = androidx.compose.runtime.key(screen) { rememberScrollState() }
    val goBack = { screen = if (screen == DemoScreen.Registration) DemoScreen.Login else DemoScreen.Welcome }
    BackHandler(enabled = screen != DemoScreen.Welcome, onBack = goBack)
    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().safeDrawingPadding().imePadding(), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.widthIn(max = 480.dp).fillMaxWidth().verticalScroll(scroll).padding(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                if (screen != DemoScreen.Welcome) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = goBack, modifier = Modifier.heightIn(min = 48.dp)) {
                            Text(stringResource(if (screen == DemoScreen.Route) R.string.home else R.string.back))
                        }
                        Text(stringResource(R.string.demo_label), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                // Recreate forms on navigation; never retain or persist demo credentials.
                androidx.compose.runtime.key(screen) {
                    when (screen) {
                        DemoScreen.Welcome -> WelcomeScreen(
                            onLogin = { screen = DemoScreen.Login },
                            onRegister = { screen = DemoScreen.Registration },
                            onPreview = { screen = DemoScreen.Route },
                        )
                        DemoScreen.Login -> LoginScreen(onContinue = { screen = DemoScreen.Route }, onRegister = { screen = DemoScreen.Registration })
                        DemoScreen.Registration -> RegistrationScreen(onContinue = { message = R.string.registration_demo })
                        DemoScreen.Route -> RouteScreen(delivery,
                            onNavigate = { message = R.string.navigation_demo },
                            onDelivered = { message = R.string.delivery_done_demo },
                            onFailed = { message = R.string.delivery_failed_demo },
                        )
                    }
                }
            }
        }
    }
    message?.let { body ->
        AlertDialog(
            onDismissRequest = { message = null },
            title = { Text(stringResource(R.string.demo_dialog_title)) },
            text = { Text(stringResource(body)) },
            confirmButton = {
                TextButton(onClick = {
                    message = null
                    if (body == R.string.registration_demo) screen = DemoScreen.Route
                }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(if (body == R.string.registration_demo) R.string.see_route else R.string.understood))
                }
            },
        )
    }
}
