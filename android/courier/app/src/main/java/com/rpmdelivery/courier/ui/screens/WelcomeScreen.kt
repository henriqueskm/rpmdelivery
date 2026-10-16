package com.rpmdelivery.courier.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.rpmdelivery.courier.R
import com.rpmdelivery.courier.ui.components.Brand
import com.rpmdelivery.courier.ui.components.DemoNotice
import com.rpmdelivery.courier.ui.components.PrimaryAction
import com.rpmdelivery.courier.ui.components.ScreenHeading
import com.rpmdelivery.courier.ui.components.StationaryNotice

@Composable
fun WelcomeScreen(onLogin: () -> Unit, onRegister: () -> Unit, onPreview: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(24.dp)) {
        Brand()
        Column(Modifier.padding(top = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(stringResource(R.string.courier_label), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            ScreenHeading(stringResource(R.string.welcome_title), stringResource(R.string.welcome_body))
        }
        Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.secondaryContainer) {
            Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.welcome_feature), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(stringResource(R.string.welcome_feature_body), style = MaterialTheme.typography.bodyMedium)
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryAction(stringResource(R.string.enter), onLogin)
            OutlinedButton(onClick = onRegister, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                Text(stringResource(R.string.create_account), textAlign = TextAlign.Center)
            }
            TextButton(onClick = onPreview, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text(stringResource(R.string.preview_route), textAlign = TextAlign.Center)
            }
        }
        DemoNotice()
        StationaryNotice()
    }
}
