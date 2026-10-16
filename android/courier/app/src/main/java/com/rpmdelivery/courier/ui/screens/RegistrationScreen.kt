package com.rpmdelivery.courier.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.rpmdelivery.courier.R
import com.rpmdelivery.courier.demo.DemoFormValidation
import com.rpmdelivery.courier.ui.components.DemoNotice
import com.rpmdelivery.courier.ui.components.DemoTextField
import com.rpmdelivery.courier.ui.components.FormSection
import com.rpmdelivery.courier.ui.components.PrimaryAction
import com.rpmdelivery.courier.ui.components.ScreenHeading

@Composable
fun RegistrationScreen(onContinue: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var model by remember { mutableStateOf("") }
    var plate by remember { mutableStateOf("") }
    var color by remember { mutableStateOf("") }
    var submitted by remember { mutableStateOf(false) }
    val keyboard = LocalSoftwareKeyboardController.current
    val required = stringResource(R.string.field_required)
    fun error(value: String) = if (submitted && !DemoFormValidation.isRequiredText(value)) required else null
    Column(verticalArrangement = Arrangement.spacedBy(24.dp)) {
        ScreenHeading(stringResource(R.string.register_title), stringResource(R.string.register_body))
        DemoNotice()
        FormSection(stringResource(R.string.your_data)) {
            DemoTextField(stringResource(R.string.name), name, { name = it }, error = error(name), capitalization = KeyboardCapitalization.Words)
            DemoTextField(stringResource(R.string.email), email, { email = it }, keyboardType = KeyboardType.Email, maxLength = 254,
                error = if (submitted && !DemoFormValidation.isEmail(email)) stringResource(R.string.invalid_email) else null)
            DemoTextField(stringResource(R.string.phone), phone, { phone = it }, keyboardType = KeyboardType.Phone, maxLength = 19)
            DemoTextField(stringResource(R.string.password), password, { password = it }, password = true,
                error = if (submitted && !DemoFormValidation.isPassword(password)) stringResource(R.string.password_required) else null)
        }
        FormSection(stringResource(R.string.your_motorcycle)) {
            DemoTextField(stringResource(R.string.model), model, { model = it }, error = error(model), maxLength = 80, capitalization = KeyboardCapitalization.Words)
            DemoTextField(stringResource(R.string.plate), plate, { plate = it.uppercase(java.util.Locale.ROOT) }, error = error(plate), maxLength = 20, capitalization = KeyboardCapitalization.Characters)
            DemoTextField(stringResource(R.string.color), color, { color = it }, error = error(color), maxLength = 40, last = true, capitalization = KeyboardCapitalization.Words)
        }
        PrimaryAction(stringResource(R.string.register_demo)) {
            submitted = true
            if (listOf(name, model, plate, color).all(DemoFormValidation::isRequiredText) &&
                DemoFormValidation.isEmail(email) && DemoFormValidation.isPassword(password)) {
                keyboard?.hide()
                password = ""
                onContinue()
            }
        }
    }
}
