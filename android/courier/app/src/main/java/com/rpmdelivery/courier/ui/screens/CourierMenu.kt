package com.rpmdelivery.courier.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.DrawerState
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import com.rpmdelivery.courier.work.WorkController
import kotlinx.coroutines.launch
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.rpmdelivery.courier.BuildConfig
import com.rpmdelivery.courier.auth.CourierRegistration
import com.rpmdelivery.courier.ui.components.BrandMark
import com.rpmdelivery.courier.ui.theme.Green
import com.rpmdelivery.courier.ui.theme.SoftGreen
import com.rpmdelivery.courier.work.Section
import com.rpmdelivery.courier.work.Shift

/** The privacy policy page on the site, the same one given to Google's app registration. */
const val PRIVACY_URL = "https://rpmdelivery.vercel.app/privacidade"

/**
 * The signed-in courier's app: the fixed top line (☰ and today's earnings), the part chosen in the
 * side menu, and the menu itself.
 */
@Composable
fun WorkShell(work: WorkController, registration: CourierRegistration, busy: Boolean, onSignOut: () -> Unit) {
    val state by work.state.collectAsState()
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    // Only the ☰ opens it; once open, a swipe or a tap outside closes it.
    ModalNavigationDrawer(drawerState = drawer, gesturesEnabled = drawer.isOpen, drawerContent = {
        CourierDrawer(drawer, registration, state.home?.shift, state.section,
            pendingStores = state.home?.stores?.count { !it.active } ?: 0, busy = busy,
            onSelect = { section -> scope.launch { drawer.close() }; work.show(section) },
            onSignOut = { scope.launch { drawer.close() }; onSignOut() })
    }) {
        Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding(), horizontalAlignment = Alignment.CenterHorizontally) {
            WorkHeader(work, onMenu = { scope.launch { drawer.open() } })
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                // The courier's day scrolls on its own terms: the queue scrolls, the route stays put.
                WorkScreen(work, registration)
            }
        }
    }
}

/**
 * The side menu: who is signed in, the parts of the app and "Sair". Opened by the ☰ on the top line only:
 * swiping from the edge would fight the swipe-to-confirm on the route.
 */
@Composable
fun CourierDrawer(
    drawer: DrawerState,
    registration: CourierRegistration,
    shift: Shift?,
    current: Section,
    pendingStores: Int,
    busy: Boolean,
    onSelect: (Section) -> Unit,
    onSignOut: () -> Unit,
) {
    var confirmSignOut by remember { mutableStateOf(false) }
    // With the drawer state the sheet also takes the back gesture while open.
    // The app's own surface, not Material's tinted default.
    ModalDrawerSheet(drawerState = drawer, modifier = Modifier.widthIn(max = 320.dp),
        drawerContainerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(vertical = 12.dp)) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                BrandMark()
                Text(registration.name.ifBlank { "Motoboy" }, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.semantics { heading() })
                listOf(registration.model, registration.plate).filter { it.isNotBlank() }.takeIf { it.isNotEmpty() }?.let {
                    Text(it.joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                shift?.let {
                    Surface(color = SoftGreen, contentColor = Green, shape = RoundedCornerShape(100.dp)) {
                        Text("Em turno · ${it.restaurantName}", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
                    }
                }
            }
            HorizontalDivider(Modifier.padding(vertical = 8.dp), color = MaterialTheme.colorScheme.outlineVariant)
            Section.entries.forEach { section ->
                NavigationDrawerItem(
                    label = { Text(section.label) },
                    selected = section == current,
                    onClick = { onSelect(section) },
                    badge = if (section == Section.Stores && pendingStores > 0) ({ Text("$pendingStores aguardando") }) else null,
                    colors = NavigationDrawerItemDefaults.colors(selectedContainerColor = SoftGreen, selectedTextColor = Green),
                    modifier = Modifier.padding(horizontal = 12.dp).heightIn(min = 56.dp),
                )
            }
            HorizontalDivider(Modifier.padding(vertical = 8.dp), color = MaterialTheme.colorScheme.outlineVariant)
            NavigationDrawerItem(label = { Text("Sair") }, selected = false, onClick = { if (!busy) confirmSignOut = true },
                modifier = Modifier.padding(horizontal = 12.dp).heightIn(min = 56.dp))
            Spacer(Modifier.heightIn(min = 16.dp))
            val uriHandler = LocalUriHandler.current
            TextButton(onClick = { uriHandler.openUri(PRIVACY_URL) }, modifier = Modifier.padding(horizontal = 16.dp).heightIn(min = 48.dp)) {
                Text("Política de privacidade")
            }
            Text("Versão ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 28.dp, vertical = 8.dp))
        }
    }
    if (confirmSignOut) AlertDialog(onDismissRequest = { confirmSignOut = false },
        title = { Text("Sair da conta?") },
        text = {
            Text(if (shift != null) "Seu turno em ${shift.restaurantName} continua aberto na loja, mas este celular para de receber avisos. Se terminou o dia, encerre o turno antes."
                else "Para voltar, entre de novo com seu e-mail e senha.")
        },
        confirmButton = {
            TextButton(onClick = { confirmSignOut = false; onSignOut() }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Sair") }
        },
        dismissButton = {
            TextButton(onClick = { confirmSignOut = false }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Cancelar") }
        })
}
