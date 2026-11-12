package com.rpmdelivery.courier.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rpmdelivery.courier.demo.DemoFormValidation
import com.rpmdelivery.courier.ui.components.DemoTextField
import com.rpmdelivery.courier.ui.components.ScreenHeading

@Composable
fun AuthAction(label: String, busy: Boolean, onClick: () -> Unit) {
    Button(onClick = onClick, enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp), shape = RoundedCornerShape(14.dp)) {
        Text(if (busy) "Aguarde…" else label, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
    }
}

@Composable
fun AccountScreen(create: Boolean, busy: Boolean, onSubmit: (String, String, String) -> Unit, onRegister: () -> Unit) {
    // Credentials intentionally absent from saved instance state and the controller.
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var submitted by remember { mutableStateOf(false) }
    val keyboard = LocalSoftwareKeyboardController.current
    Column(verticalArrangement = Arrangement.spacedBy(24.dp)) {
        ScreenHeading(if (create) "Vamos começar?" else "Bom ter você aqui.",
            if (create) "Primeiro crie sua conta. Depois, confirme o e-mail e complete os dados da sua moto."
            else "Entre na sua conta de motoboy com segurança.")
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (create) DemoTextField("Nome completo", name, { name = it }, maxLength = 120, capitalization = KeyboardCapitalization.Words,
                error = if (submitted && name.isBlank()) "Preencha seu nome." else null)
            DemoTextField("E-mail", email, { email = it }, keyboardType = KeyboardType.Email, maxLength = 254,
                error = if (submitted && !DemoFormValidation.isEmail(email)) "Confira seu endereço de e-mail." else null)
            DemoTextField("Senha", password, { password = it }, password = true, last = true, maxLength = 128,
                error = if (submitted && (password.isEmpty() || (create && password.length < 8)))
                    if (create) "Use pelo menos 8 caracteres." else "Digite sua senha." else null)
        }
        AuthAction(if (create) "Criar minha conta" else "Entrar na minha conta", busy) {
            submitted = true
            if ((!create || name.isNotBlank()) && DemoFormValidation.isEmail(email) && password.isNotEmpty() && (!create || password.length >= 8)) {
                keyboard?.hide()
                val credential = password
                submitted = false
                password = ""
                onSubmit(name, email, credential)
            }
        }
        if (!create) TextButton(onClick = onRegister, enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text("Criar cadastro de motoboy")
        }
    }
}
