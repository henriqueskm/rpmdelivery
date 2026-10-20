package com.rpmdelivery.courier.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.rpmdelivery.courier.R
import com.rpmdelivery.courier.demo.DemoFormValidation
import com.rpmdelivery.courier.ui.components.DemoNotice
import com.rpmdelivery.courier.ui.components.DemoTextField
import com.rpmdelivery.courier.ui.components.PrimaryAction
import com.rpmdelivery.courier.ui.components.ScreenHeading

@Composable
fun LoginScreen(onContinue: () -> Unit, onRegister: () -> Unit) {
    // Intentionally not rememberSaveable: no credential in saved instance state.
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var submitted by remember { mutableStateOf(false) }
    val keyboard = LocalSoftwareKeyboardController.current
    Column(verticalArrangement = Arrangement.spacedBy(24.dp)) {
        ScreenHeading(stringResource(R.string.login_title), stringResource(R.string.login_body))
        DemoNotice()
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            DemoTextField(stringResource(R.string.email), email, { email = it }, keyboardType = KeyboardType.Email, maxLength = 254,
                error = if (submitted && !DemoFormValidation.isEmail(email)) stringResource(R.string.invalid_email) else null)
            DemoTextField(stringResource(R.string.password), password, { password = it }, password = true, last = true,
                error = if (submitted && !DemoFormValidation.isPassword(password)) stringResource(R.string.password_required) else null)
        }
        PrimaryAction(stringResource(R.string.login_demo)) {
            submitted = true
            if (DemoFormValidation.isEmail(email) && DemoFormValidation.isPassword(password)) {
                keyboard?.hide()
                password = ""
                onContinue()
            }
        }
        TextButton(onClick = onRegister, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text(stringResource(R.string.create_account))
        }
    }
}
