package com.rpmdelivery.courier.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.InputTransformation
import androidx.compose.foundation.text.input.OutputTransformation
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.delete
import androidx.compose.foundation.text.input.insert
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import com.rpmdelivery.courier.R
import com.rpmdelivery.courier.registration.BrazilianPhone

internal val brazilianPhoneInput = InputTransformation {
    val parsed = BrazilianPhone.parseInput(asCharSequence().toString())
    if (parsed == null) {
        revertAllChanges()
    } else {
        // In-place edits preserve selection/composition; never replace the whole field.
        for (index in length - 1 downTo 0) if (charAt(index) !in '0'..'9') delete(index, index + 1)
        if (parsed.countryPrefixDigits > 0) delete(0, parsed.countryPrefixDigits)
    }
}

internal val brazilianPhoneOutput = OutputTransformation {
    BrazilianPhone.maskInsertions(length).forEach { (index, text) -> insert(index, text) }
}

@Composable
fun RegistrationPhoneField(state: TextFieldState, showError: Boolean) {
    OutlinedTextField(
        state = state,
        label = { Text(stringResource(R.string.phone)) },
        modifier = Modifier.fillMaxWidth(),
        lineLimits = TextFieldLineLimits.SingleLine,
        inputTransformation = brazilianPhoneInput,
        outputTransformation = brazilianPhoneOutput,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Next, autoCorrectEnabled = false),
        isError = showError,
        supportingText = if (showError) { { Text(stringResource(R.string.invalid_phone)) } } else null,
    )
}
