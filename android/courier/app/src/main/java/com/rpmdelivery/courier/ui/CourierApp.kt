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
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.rpmdelivery.courier.auth.AuthController
import com.rpmdelivery.courier.auth.AuthCopy
import com.rpmdelivery.courier.auth.AuthScreen
import com.rpmdelivery.courier.demo.sampleDelivery
import com.rpmdelivery.courier.ui.components.Brand
import com.rpmdelivery.courier.ui.components.DemoNotice
import com.rpmdelivery.courier.ui.components.ScreenHeading
import com.rpmdelivery.courier.ui.screens.AccountScreen
import com.rpmdelivery.courier.ui.screens.AuthAction
import com.rpmdelivery.courier.ui.screens.CourierProfileScreen
import com.rpmdelivery.courier.ui.screens.RouteScreen
import com.rpmdelivery.courier.ui.screens.WelcomeScreen

@Composable
fun CourierApp(controller: AuthController) {
    val state by controller.state.collectAsState()
    var previewMessage by remember { mutableStateOf(false) }
    val back = { controller.navigate(if (state.authenticated) AuthScreen.Home else AuthScreen.Welcome) }
    BackHandler(state.screen !in setOf(AuthScreen.Welcome, AuthScreen.Home, AuthScreen.Loading), onBack = back)
    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().safeDrawingPadding().imePadding(), contentAlignment = Alignment.TopCenter) {
            key(state.screen) {
                Column(Modifier.widthIn(max = 480.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    if (state.screen != AuthScreen.Welcome) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        TextButton(onClick = back, enabled = !state.busy, modifier = Modifier.heightIn(min = 48.dp)) { Text("Início") }
                        if (state.authenticated) TextButton(onClick = controller::logout, enabled = !state.busy, modifier = Modifier.heightIn(min = 48.dp)) { Text("Sair") }
                    }
                    if (state.busy) {
                        LinearProgressIndicator(Modifier.fillMaxWidth())
                        Text("Aguarde…", modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                    }
                    state.message?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
                    when (state.screen) {
                        AuthScreen.Loading -> Text("Recuperando sua sessão protegida…")
                        AuthScreen.Welcome -> WelcomeScreen(
                            onLogin = { controller.navigate(AuthScreen.Login) },
                            onRegister = { controller.navigate(AuthScreen.Account) },
                            onPreview = { controller.navigate(AuthScreen.Preview) },
                            realAccount = true,
                        )
                        AuthScreen.Login, AuthScreen.Account -> AccountScreen(state.screen == AuthScreen.Account, state.busy,
                            onSubmit = { name, email, password ->
                                if (state.screen == AuthScreen.Account) controller.signup(name, email, password)
                                else controller.login(email, password)
                            }, onRegister = { controller.navigate(AuthScreen.Account) })
                        AuthScreen.ConfirmEmail -> {
                            Brand()
                            ScreenHeading(AuthCopy.CONFIRM, "A conta ainda não está autenticada. Abra a mensagem de confirmação e depois entre com sua senha. Se já tinha conta, use o login.")
                            Text("Depois de confirmar, volte ao aplicativo e entre na sua conta.")
                            AuthAction("Já confirmei · Entrar", state.busy) { controller.navigate(AuthScreen.Login) }
                        }
                        AuthScreen.Profile -> CourierProfileScreen(state.registration, state.busy, controller::complete,
                            onLater = { controller.navigate(AuthScreen.Home) })
                        AuthScreen.Home -> {
                            Brand()
                            ScreenHeading(if (state.registration.complete) "Cadastro de motoboy concluído" else "Conta criada · cadastro pendente",
                                if (state.registration.complete) "Seus dados de motoboy estão salvos com segurança."
                                else "Complete os dados da sua moto quando estiver pronto. Não escolha um modelo diferente do seu.")
                            Text("Nenhuma rota conectada neste aplicativo", style = MaterialTheme.typography.titleMedium)
                            Text("A consulta de rotas reais ainda não foi integrada. A prévia abaixo é uma demonstração independente com dados fictícios.")
                            if (!state.registration.complete) AuthAction("Completar cadastro", state.busy) { controller.navigate(AuthScreen.Profile) }
                            AuthAction("Recarregar dados", state.busy, controller::reload)
                            TextButton(onClick = { controller.navigate(AuthScreen.Preview) }, enabled = !state.busy, modifier = Modifier.heightIn(min = 48.dp)) { Text("Conhecer Minha rota · demonstração") }
                        }
                        AuthScreen.Preview -> {
                            DemoNotice()
                            RouteScreen(sampleDelivery, onNavigate = { previewMessage = true }, onDelivered = { previewMessage = true }, onFailed = { previewMessage = true })
                        }
                        AuthScreen.Recovery -> {
                            ScreenHeading("Vamos recuperar o acesso", "Nenhuma rota ou cadastro será liberado antes de validar sua sessão.")
                            AuthAction("Tentar novamente", state.busy, controller::restore)
                            TextButton(onClick = controller::logout, enabled = !state.busy, modifier = Modifier.heightIn(min = 48.dp)) { Text("Limpar sessão local e sair") }
                        }
                    }
                }
            }
        }
    }
    if (previewMessage) AlertDialog(onDismissRequest = { previewMessage = false },
        title = { Text("Você está em uma demonstração") }, text = { Text("Nenhum pedido, mapa, rastreamento ou notificação real foi acessado ou alterado.") },
        confirmButton = { TextButton(onClick = { previewMessage = false }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Entendi") } })
}
