package com.rpmdelivery.courier.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.rpmdelivery.courier.R
import com.rpmdelivery.courier.registration.MotorcycleCatalog
import com.rpmdelivery.courier.registration.MotorcycleSelection

@Composable
fun MotorcyclePicker(selection: MotorcycleSelection, onChange: (MotorcycleSelection) -> Unit, showError: Boolean, notFoundMessage: String? = null) {
    var focused by remember { mutableStateOf(false) }
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val queryFocus = remember { FocusRequester() }
    val selectedLabel = stringResource(R.string.model_selected)
    val results = remember(selection.query) { MotorcycleCatalog.search(selection.query) }
    fun closeSearch() { focus.clearFocus(); keyboard?.hide() }
    Column(modifier = Modifier.onFocusChanged { focused = it.hasFocus }.focusGroup(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        DemoTextField(
            label = stringResource(R.string.model), value = selection.query,
            onValueChange = { onChange(selection.edit(it)) }, maxLength = MotorcycleCatalog.MODEL_MAX_LENGTH,
            modifier = Modifier.focusRequester(queryFocus).semantics {
                if (selection.selected != null) stateDescription = selectedLabel
            },
            error = if (showError && !selection.notFound) stringResource(R.string.model_selection_required) else null,
            hint = if (selection.selected != null) selectedLabel else stringResource(R.string.model_search_hint),
        )
        // Keep a pending query visible while keyboard focus moves into its results.
        if ((focused || selection.query.isNotBlank()) && selection.selected == null && !selection.notFound) {
            Text(
                if (results.isEmpty()) stringResource(R.string.model_no_results) else pluralStringResource(R.plurals.model_result_count, results.size, results.size),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
            if (results.isNotEmpty()) {
                Surface(shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                    Column {
                        results.take(4).forEachIndexed { index, model ->
                            if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            TextButton(onClick = { onChange(selection.choose(model.id)); closeSearch() }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
                                Text(model.displayName, textAlign = TextAlign.Start, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp))
                            }
                        }
                    }
                }
            }
            TextButton(onClick = { onChange(selection.markNotFound()); closeSearch() }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text(stringResource(R.string.model_not_found), textAlign = TextAlign.Start, modifier = Modifier.fillMaxWidth())
            }
        }
        if (selection.notFound) {
            Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(12.dp)) {
                Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(stringResource(R.string.model_not_found_title), style = MaterialTheme.typography.titleSmall)
                    Text(notFoundMessage ?: stringResource(R.string.model_not_found_body), style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = { onChange(MotorcycleSelection()); queryFocus.requestFocus(); keyboard?.show() }, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.model_search_again))
                    }
                }
            }
        }
    }
}
