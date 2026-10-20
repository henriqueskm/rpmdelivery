package com.rpmdelivery.courier.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.rpmdelivery.courier.auth.CourierRegistration
import com.rpmdelivery.courier.registration.BrazilianPhone
import com.rpmdelivery.courier.registration.MotorcycleSelection
import com.rpmdelivery.courier.ui.components.DemoTextField
import com.rpmdelivery.courier.ui.components.FormSection
import com.rpmdelivery.courier.ui.components.MotorcyclePicker
import com.rpmdelivery.courier.ui.components.RegistrationPhoneField
import com.rpmdelivery.courier.ui.components.ScreenHeading

@Composable
fun CourierProfileScreen(existing: CourierRegistration, busy: Boolean, onSubmit: (CourierRegistration) -> Unit, onLater: () -> Unit) {
    var name by remember { mutableStateOf("") }
    val phone = remember { TextFieldState() }
    var motorcycle by remember { mutableStateOf(MotorcycleSelection()) }
    var plate by remember { mutableStateOf("") }
    var color by remember { mutableStateOf("") }
    var submitted by remember { mutableStateOf(false) }
    val keyboard = LocalSoftwareKeyboardController.current
    val savedPhone = existing.phone.takeIf { existing.hasStoredPhone }
    fun error(value: String) = if (submitted && value.isBlank()) "Preencha este campo." else null
    @Composable fun saved(label: String, value: String) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Text(value, style = MaterialTheme.typography.bodyLarge)
        Text("Já cadastrado · preservado", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Column(verticalArrangement = Arrangement.spacedBy(24.dp)) {
        ScreenHeading("Complete seu cadastro", "Sua conta está autenticada. Falta completar os dados de motoboy; as informações válidas já salvas serão preservadas.")
        FormSection("Seus dados") {
            if (existing.valid(existing.name, 120)) saved("Nome completo", existing.name)
            else DemoTextField("Nome completo", name, { name = it }, error = error(name), maxLength = 120, capitalization = KeyboardCapitalization.Words)
            if (savedPhone != null) saved("Celular com DDD", BrazilianPhone.format(savedPhone.drop(3)))
            else RegistrationPhoneField(phone, showError = submitted && !BrazilianPhone.isValidOptional(phone.text.toString()))
        }
        FormSection("Sua moto") {
            if (existing.valid(existing.model, 80)) saved("Modelo da moto", existing.model)
            else MotorcyclePicker(motorcycle, { motorcycle = it }, showError = submitted && motorcycle.selected == null,
                notFoundMessage = "Sua conta já está criada. Não escolha outro modelo. Você pode deixar o cadastro pendente e voltar quando sua moto estiver disponível no catálogo.")
            if (existing.valid(existing.plate, 20)) saved("Placa", existing.plate)
            else DemoTextField("Placa", plate, { plate = it.uppercase(java.util.Locale.ROOT) }, error = error(plate), maxLength = 20, capitalization = KeyboardCapitalization.Characters)
            if (existing.valid(existing.color, 40)) saved("Cor da moto", existing.color)
            else DemoTextField("Cor da moto", color, { color = it }, error = error(color), maxLength = 40, last = true, capitalization = KeyboardCapitalization.Words)
        }
        AuthAction("Concluir cadastro de motoboy", busy) {
            submitted = true
            val input = CourierRegistration(name, BrazilianPhone.toE164(phone.text.toString()).orEmpty(), motorcycle.selected?.displayName.orEmpty(), plate, color)
            if (existing.mergedWith(input).complete && BrazilianPhone.isValidOptional(phone.text.toString())) {
                keyboard?.hide(); onSubmit(input)
            }
        }
        TextButton(onClick = onLater, enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Completar depois") }
    }
}
