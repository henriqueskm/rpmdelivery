package com.rpmdelivery.courier.ui.screens

import android.Manifest
import android.graphics.BitmapFactory
import androidx.activity.result.PickVisualMediaRequest
import androidx.compose.foundation.Image
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import com.rpmdelivery.courier.ui.components.ProfilePhoto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import android.annotation.SuppressLint
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.widthIn
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.BottomSheetScaffold
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SheetValue
import androidx.compose.material3.rememberBottomSheetScaffoldState
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.testTag
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import kotlinx.coroutines.launch
import androidx.compose.material3.IconButton
import com.rpmdelivery.courier.auth.CourierRegistration
import com.rpmdelivery.courier.registration.BrazilianPhone
import com.rpmdelivery.courier.work.Section
import com.rpmdelivery.courier.ui.theme.Ink
import com.rpmdelivery.courier.work.Today
import com.rpmdelivery.courier.work.historyDate
import com.rpmdelivery.courier.work.reais
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.rpmdelivery.courier.shift.ShiftService
import com.rpmdelivery.courier.shift.PickupWake
import com.rpmdelivery.courier.shift.RouteBubble
import com.rpmdelivery.courier.shift.CurrentPosition
import com.rpmdelivery.courier.work.WorkCopy
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.net.toUri
import com.rpmdelivery.courier.R
import com.rpmdelivery.courier.ui.components.StationaryNotice
import com.rpmdelivery.courier.ui.components.SwipeToConfirm
import com.rpmdelivery.courier.ui.theme.Coral
import com.rpmdelivery.courier.ui.theme.Green
import com.rpmdelivery.courier.ui.theme.SoftCoral
import com.rpmdelivery.courier.ui.theme.SoftGreen
import com.rpmdelivery.courier.work.CourierRoute
import com.rpmdelivery.courier.work.FailureReason
import com.rpmdelivery.courier.work.Shift
import com.rpmdelivery.courier.work.Stop
import com.rpmdelivery.courier.work.Store
import com.rpmdelivery.courier.work.WorkController
import com.rpmdelivery.courier.work.WorkState
import com.rpmdelivery.courier.work.clockTime
import com.rpmdelivery.courier.work.InviteCard
import com.rpmdelivery.courier.work.InviteLink
import com.rpmdelivery.courier.work.InvitePhase
import com.rpmdelivery.courier.ui.components.InviteScanner
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import com.rpmdelivery.courier.work.stopLabel

/** The signed-in courier's day: ask for a shift, wait in line, run the route, come back. */
@Composable
fun WorkScreen(work: WorkController, registration: CourierRegistration = CourierRegistration()) {
    val state by work.state.collectAsState()
    DisposableEffect(work) {
        work.setShown(true)
        onDispose { work.setShown(false) }
    }
    val context = LocalContext.current
    fun open(intent: Intent, missing: String) {
        try { context.startActivity(intent) } catch (_: ActivityNotFoundException) { work.inform(missing) }
    }

    // The shift service follows the open shift: alerts while waiting, GPS on the route.
    val shiftOpen = state.home?.shift != null
    LaunchedEffect(shiftOpen, state.home != null) {
        if (shiftOpen) ShiftService.start(context) else if (state.home != null) ShiftService.stop(context)
    }
    // On the street (route started or heading back) the bubble over the maps app may show.
    val onStreet = state.home?.route?.status.let { it == "ON_ROUTE" || it == "RETURNING" }
    LaunchedEffect(onStreet, state.home != null) { if (state.home != null) RouteBubble.setRoute(context, onStreet) }

    // Permissions are asked at the moment they make sense; a refusal never blocks the work.
    var locationOn by remember { mutableStateOf(hasLocation(context)) }
    var pendingStore by remember { mutableStateOf<Store?>(null) }
    val notificationsAsk = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        pendingStore?.let(work::requestShift); pendingStore = null
    }
    var pendingRoute by remember { mutableStateOf<CourierRoute?>(null) }
    val locationAsk = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        locationOn = hasLocation(context)
        pendingRoute?.let(work::startRoute); pendingRoute = null
    }
    val askLocation = { locationAsk.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) }
    var scanning by remember { mutableStateOf(false) }

    val actions = WorkActions(
        requestShift = { store ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                pendingStore = store
                notificationsAsk.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else work.requestShift(store)
        },
        endShift = work::endShift,
        startRoute = { route ->
            if (hasLocation(context)) work.startRoute(route) else { pendingRoute = route; askLocation() }
        },
        askLocation = askLocation,
        locationOn = locationOn,
        // Each swipe carries where the phone is: the server compares it with the address or the store.
        complete = { route, stop -> work.completeDelivery(route, stop, CurrentPosition.read(context)) },
        fail = work::reportFailure,
        arrive = { route -> work.arriveAtStore(route, CurrentPosition.read(context)) },
        retry = work::refresh,
        openHistory = work::openHistory,
        navigate = { query -> open(Intent(Intent.ACTION_VIEW, query.toUri()), "Nenhum aplicativo de mapas encontrado neste aparelho.") },
        dial = { phone -> open(Intent(Intent.ACTION_DIAL, "tel:$phone".toUri()), "Nenhum aplicativo de telefone encontrado neste aparelho.") },
        invite = InviteActions(
            scan = { scanning = true },
            enter = work::receiveInvite,
            request = work::requestLink,
            dismiss = work::dismissInvite,
            retry = work::retryInvite,
        ),
    )
    if (scanning) InviteScanner(onInvite = { code -> scanning = false; work.receiveInvite(code) }, onClose = { scanning = false })
    // "Entregue" far from the address: confirm only if it really was delivered; the store sees the distance.
    state.farPrompt?.let { prompt ->
        AlertDialog(onDismissRequest = work::cancelFarDelivery,
            title = { Text("Você está longe do endereço") },
            text = {
                Text("O celular está a ${WorkCopy.distance(prompt.meters)} do endereço de ${prompt.customerName}. " +
                    "Confirme só se entregou mesmo: a loja vai ver a distância.")
            },
            confirmButton = {
                TextButton(onClick = work::confirmFarDelivery, modifier = Modifier.heightIn(min = 48.dp)) { Text("Confirmar entrega") }
            },
            dismissButton = {
                TextButton(onClick = work::cancelFarDelivery, modifier = Modifier.heightIn(min = 48.dp)) { Text("Cancelar") }
            })
    }
    // Back from any part of the menu returns to Início.
    BackHandler(enabled = state.section != Section.Home) { work.show(Section.Home) }
    val route = state.home?.route
    val home = { work.show(Section.Home) }
    when (state.section) {
        Section.Earnings -> Scrolling { HistoryContent(state, onBack = home, onRetry = work::loadHistory) }
        Section.Stores -> Scrolling { StoresDirectory(state, actions, onBack = home) }
        Section.Profile -> Scrolling {
            ProfileContent(registration, state, onDelete = work::deleteAccount, onBack = home,
                onPhoto = work::savePhoto, onRemovePhoto = work::removePhoto)
        }
        Section.Alerts -> Scrolling { AlertsContent(onBack = home) }
        Section.Help -> Scrolling { HelpContent(onBack = home) }
        Section.Home -> HomeContent(state, route, actions)
    }
}

@Composable
private fun HomeContent(state: WorkState, route: CourierRoute?, actions: WorkActions) {
    when {
        // On the street the screen stays put; the route's stops slide up from the bottom.
        route != null && (route.status == "ON_ROUTE" || route.status == "RETURNING") -> RouteSheetScreen(state, route, actions)
        else -> Scrolling { WorkContent(state, actions) }
    }
}

@Composable
private fun Scrolling(content: @Composable () -> Unit) {
    Column(Modifier.widthIn(max = 480.dp).fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) { content() }
}

/**
 * What every courier screen says first: no connection, what just worked, what was refused.
 * [refusalBelow]: on a route the refusal shows under the swipe instead (see [Refusal]).
 */
@Composable
private fun Feedback(state: WorkState, refusalBelow: Boolean = false) {
    if (state.offline) Banner("Sem conexão. Mostrando os últimos dados; o aplicativo tenta de novo sozinho.", SoftCoral)
    state.notice?.let { Banner(it, SoftGreen, Green) }
    if (!refusalBelow) state.message?.let {
        Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    }
}

/**
 * Why a swipe did not go through ("você está a 2,3 km da loja"), right under the swipe. At the top of
 * the screen it went unseen and the thumb sliding back looked like a swipe that failed.
 */
@Composable
private fun Refusal(message: String?) {
    message ?: return
    Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyLarge,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.fillMaxWidth().background(SoftCoral, RoundedCornerShape(12.dp)).padding(12.dp)
            .semantics { liveRegion = LiveRegionMode.Polite })
}

/**
 * The route on the street: the current stop and its actions fixed on screen, and a sheet at the
 * bottom with every stop of the route and the store's phone. The sheet opens to three quarters of
 * the screen at most, so the stop above stays in sight. Only with very large text, when the stop
 * cannot fit, does the top part scroll.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RouteSheetScreen(state: WorkState, route: CourierRoute, actions: WorkActions) {
    val sheet = rememberBottomSheetScaffoldState()
    val scope = rememberCoroutineScope()
    val open = sheet.bottomSheetState.targetValue == SheetValue.Expanded
    BackHandler(enabled = open) { scope.launch { sheet.bottomSheetState.partialExpand() } }
    BoxWithConstraints(Modifier.widthIn(max = 480.dp).fillMaxSize()) {
        val sheetMax = maxHeight * 0.75f
        BottomSheetScaffold(
            scaffoldState = sheet,
            // Closed it shows the handle and the title line only, never half a stop.
            sheetPeekHeight = 82.dp,
            sheetShape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp),
            sheetContainerColor = MaterialTheme.colorScheme.surface,
            sheetShadowElevation = 10.dp,
            containerColor = MaterialTheme.colorScheme.background,
            sheetDragHandle = {
                Box(Modifier.padding(top = 10.dp, bottom = 4.dp).size(width = 36.dp, height = 4.dp)
                    .background(MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(2.dp)))
            },
            sheetContent = {
                Column(Modifier.fillMaxWidth().heightIn(max = sheetMax).padding(horizontal = 20.dp)) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp)
                        .clickable(onClickLabel = if (open) "Fechar a lista" else "Ver as entregas") {
                            scope.launch { if (open) sheet.bottomSheetState.partialExpand() else sheet.bottomSheetState.expand() }
                        }, verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Entregas da rota", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.semantics { heading() })
                            Text("${entregues(route.delivered)} de ${route.stops.size}", style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text(if (open) "▾" else "▴", fontSize = 18.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Column(Modifier.verticalScroll(rememberScrollState()).padding(top = 4.dp, bottom = 20.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        StopRows(route)
                        route.store.phone?.let { phone ->
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            TextButton(onClick = { actions.dial(phone) }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Ligar para a loja") }
                        }
                    }
                }
            },
        ) { inner ->
            Column(Modifier.fillMaxSize().padding(inner).verticalScroll(rememberScrollState()).padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Feedback(state, refusalBelow = true)
                RouteContent(route, state.home?.shift, state.busy, actions, withStops = false, refusal = state.message)
                StationaryNotice()
            }
        }
    }
}

/**
 * The courier's fixed top line: the menu, and today's earnings in the middle.
 * The earnings only show with an open shift: off duty there is nothing to follow.
 */
@Composable
fun WorkHeader(work: WorkController, onMenu: () -> Unit) {
    val state by work.state.collectAsState()
    Row(Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 12.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onMenu, modifier = Modifier.size(48.dp)) {
            Icon(painterResource(R.drawable.menu), contentDescription = "Abrir menu", tint = MaterialTheme.colorScheme.onSurface)
        }
        Box(Modifier.weight(1f).padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
            val today = state.home?.today
            if (today != null && state.home?.shift != null && !state.historyOpen) EarningsPill(today, work::openHistory)
        }
        // Same width as the ☰, so the middle stays centered.
        Spacer(Modifier.size(48.dp))
    }
}

/** Money to receive today. Tapping it opens the history; nothing about past days is read before that. */
@Composable
private fun EarningsPill(today: Today, onOpen: () -> Unit) {
    val deliveries = if (today.deliveries == 1) "1 entrega" else "${today.deliveries} entregas"
    Surface(onClick = onOpen, shape = RoundedCornerShape(100.dp), color = Ink, contentColor = Color.White,
        shadowElevation = 4.dp,
        modifier = Modifier.heightIn(min = 48.dp).semantics {
            contentDescription = "A receber hoje: ${reais(today.totalCents)}, $deliveries. Abrir histórico"
        }) {
        Row(Modifier.padding(start = 18.dp, end = 14.dp, top = 10.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(reais(today.totalCents), fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1)
            Text("▾", fontSize = 14.sp)
        }
    }
}

/**
 * Asks Android, in its own small dialog, to let the app run without battery restriction: the shift's
 * alerts (next in line, route released) must ring with the screen off. Falls back to the app's settings page.
 */
@SuppressLint("BatteryLife") // Core function: a courier waiting in line must get the alert while the phone sleeps.
fun askBatteryExemption(context: Context) {
    val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, "package:${context.packageName}".toUri())
    val details = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:${context.packageName}".toUri())
    try { context.startActivity(direct) }
    catch (_: ActivityNotFoundException) { try { context.startActivity(details) } catch (_: ActivityNotFoundException) { } }
}

fun hasLocation(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

class WorkActions(
    val requestShift: (Store) -> Unit,
    val endShift: (Shift) -> Unit,
    val startRoute: (CourierRoute) -> Unit,
    /** Asks for location again; [locationOn] says whether the route is being shared. */
    val askLocation: () -> Unit = {},
    val locationOn: Boolean = true,
    val complete: (CourierRoute, Stop) -> Unit,
    val fail: (CourierRoute, Stop, FailureReason, String) -> Unit,
    val arrive: (CourierRoute) -> Unit,
    val retry: () -> Unit,
    val openHistory: () -> Unit = {},
    /** Opens a geo: URI in the installed maps app. */
    val navigate: (String) -> Unit,
    val dial: (String) -> Unit,
    val invite: InviteActions = InviteActions(),
)

/** A store's invite: read its QR Code, type its code, then ask that store for a link. */
class InviteActions(
    val scan: () -> Unit = {},
    /** A code already normalized by [InviteLink.normalize]. */
    val enter: (String) -> Unit = {},
    val request: () -> Unit = {},
    val dismiss: () -> Unit = {},
    val retry: () -> Unit = {},
)

/**
 * geo: URI for a place, by its written address first: the maps app finds the house with its own data.
 * Our coordinates come from Mapbox and are approximate in Brazil (a few houses off, sometimes the corner),
 * and a bare coordinate makes Google label the pin with whatever address it thinks is there.
 * The coordinates are only used when there is no address to search.
 */
fun mapQuery(latitude: Double?, longitude: Double?, address: String): String = when {
    address.isNotBlank() -> "geo:0,0?q=${Uri.encode(address.trim())}"
    latitude != null && longitude != null -> "geo:$latitude,$longitude?q=$latitude,$longitude"
    else -> "geo:0,0"
}

/** What to search for a stop: street and number, then bairro, then the rest (city, CEP) as the provider wrote it. */
fun stopSearch(address: String, neighborhood: String?): String {
    val bairro = neighborhood?.trim().orEmpty()
    if (bairro.isEmpty() || address.contains(bairro, ignoreCase = true)) return address.trim()
    val comma = address.indexOf(',')
    return if (comma < 0) "${address.trim()}, $bairro"
    else "${address.substring(0, comma).trim()}, $bairro, ${address.substring(comma + 1).trim()}"
}

@Composable
fun WorkContent(state: WorkState, actions: WorkActions) {
    val home = state.home
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Feedback(state, refusalBelow = home?.route != null)
        state.invite?.let { InviteContent(it, state.busy, actions.invite) }
        when {
            home == null && state.loading -> Text("Carregando suas lojas e seu turno…")
            home == null -> OutlinedButton(onClick = actions.retry, enabled = !state.busy,
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp), shape = RoundedCornerShape(14.dp)) { Text("Tentar novamente") }
            home.route != null -> RouteContent(home.route, home.shift, state.busy, actions, refusal = state.message)
            home.shift != null -> {
                ShiftContent(home.shift, state.busy, actions)
                // Waiting in line: make sure the alerts will reach the pocket, and show the day so far.
                ReadyChecks()
                home.today?.let { YourDay(it, home.shift, actions.openHistory) }
            }
            // With an invite open, its card is the one action: no second reader or code field below it.
            state.invite != null -> if (home.stores.isNotEmpty()) StoresContent(home.stores, state.busy, actions, inviting = true)
            else -> StoresContent(home.stores, state.busy, actions)
        }
        StationaryNotice()
    }
}

/** The courier's last 30 days, one line per day and store. */
@Composable
private fun HistoryContent(state: WorkState, onBack: () -> Unit, onRetry: () -> Unit) {
    val history = state.history
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Card {
            Heading("Histórico", "Últimos 30 dias")
            when {
                history == null && state.historyError != null -> {
                    Text(state.historyError, color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                    Secondary("Tentar novamente", state.historyLoading, onRetry)
                }
                history == null -> Text("Carregando seus ganhos…")
                history.isEmpty() -> Text("Nenhum ganho nos últimos 30 dias.", style = MaterialTheme.typography.bodyLarge)
                else -> {
                    Surface(color = SoftGreen, contentColor = Green, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp)) {
                            Text(reais(history.sumOf { it.totalCents }), fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
                            Text("${entregasTotal(history.sumOf { it.deliveries })} em 30 dias", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    history.forEach { day ->
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { },
                            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text("${historyDate(day.day)} · ${day.restaurantName}", style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.SemiBold)
                                Text("${entregasTotal(day.deliveries)} · encosta ${reais(day.shiftFeeCents)} · entregas ${reais(day.deliveryFeesCents)}",
                                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Text(reais(day.totalCents), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
            Text("Valores pelas taxas da loja: encosta uma vez por dia e só entregas concluídas. O pagamento é combinado com a loja.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Secondary("Voltar", false, onBack)
        }
    }
}

private fun entregasTotal(count: Int) = if (count == 1) "1 entrega" else "$count entregas"

@Composable
private fun Banner(text: String, color: androidx.compose.ui.graphics.Color, content: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurface) {
    Surface(color = color, contentColor = content, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
        Text(text, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium,
            modifier = Modifier.padding(14.dp).semantics { liveRegion = LiveRegionMode.Polite })
    }
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    Surface(shape = RoundedCornerShape(20.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { content() }
    }
}

@Composable
private fun Heading(title: String, detail: String? = null, chip: String? = null) {
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, fontSize = 26.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
            detail?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        chip?.let {
            Surface(color = SoftGreen, contentColor = Green, shape = RoundedCornerShape(100.dp)) {
                Text(it, modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun Primary(label: String, busy: Boolean, onClick: () -> Unit) {
    Button(onClick = onClick, enabled = !busy, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
        Text(label, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, modifier = Modifier.padding(vertical = 4.dp))
    }
}

@Composable
private fun Secondary(label: String, busy: Boolean, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, enabled = !busy, shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.onSurface),
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
        Text(label, fontSize = 16.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(vertical = 4.dp))
    }
}

@Composable
private fun NavigationButton(title: String, hint: String, onClick: () -> Unit) {
    Surface(onClick = onClick, shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth().heightIn(min = 72.dp)) {
        Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(painterResource(R.drawable.navigation_arrow), contentDescription = null, modifier = Modifier.size(22.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

// ---------------------------------------------------------------- stores and shift

@Composable
private fun StoresContent(stores: List<Store>, busy: Boolean, actions: WorkActions, inviting: Boolean = false) {
    val active = stores.filter { it.active }
    val waiting = stores.filterNot { it.active }
    Card {
        if (active.isEmpty()) {
            Heading("Nenhuma loja aprovada")
            if (!inviting) {
                Text("Peça o convite à loja e leia o QR Code aqui no aplicativo. Quando a loja aprovar, ela aparece aqui.",
                    style = MaterialTheme.typography.bodyLarge)
                Primary("Ler QR Code do convite", busy, actions.invite.scan)
                InviteCodeEntry(busy, actions.invite.enter)
            }
        } else {
            Heading("Pronto para começar?", "Ao chegar na loja, peça seu turno. A loja aprova e você entra na fila.")
            active.forEach { store ->
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Text(store.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                // With one store its name is right above; with several, each button names its store.
                Primary(if (active.size == 1) "Cheguei · pedir turno" else "Pedir turno em ${store.name}", busy) { actions.requestShift(store) }
            }
        }
        waiting.forEach {
            Text("Aguardando a loja ${it.name} aprovar seu vínculo.", style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        // Already working for a store: another store's invite is a quiet link, not the main action.
        if (active.isNotEmpty() && !inviting) TextButton(onClick = actions.invite.scan, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) {
            Text("Ler convite de outra loja")
        }
    }
}

/** The code printed under the QR Code, for when the camera cannot read it. */
@Composable
private fun InviteCodeEntry(busy: Boolean, onCode: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    var text by remember { mutableStateOf("") }
    var wrong by remember { mutableStateOf(false) }
    if (!open) {
        TextButton(onClick = { open = true }, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) { Text("Digitar o código do convite") }
        return
    }
    OutlinedTextField(value = text, onValueChange = { text = it.take(30); wrong = false }, label = { Text("Código do convite") },
        supportingText = { Text(if (wrong) "Digite os 20 caracteres do código, com ou sem hífens." else "20 caracteres, com ou sem hífens") },
        isError = wrong, singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false, imeAction = ImeAction.Done))
    Secondary("Continuar com o código", busy) {
        val code = InviteLink.normalize(text)
        if (code == null) wrong = true else { onCode(code); text = ""; open = false }
    }
}

/** The invite just read: which store it is and the request for a link. */
@Composable
private fun InviteContent(card: InviteCard, busy: Boolean, actions: InviteActions) {
    Card {
        val name = card.restaurantName
        when (card.phase) {
            InvitePhase.Waiting, InvitePhase.Checking -> {
                Heading("Convite recebido")
                Text("Conferindo o convite…", modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            }
            InvitePhase.Ready, InvitePhase.Sending -> {
                Heading(name ?: "Convite de uma loja", "Convite para trabalhar com esta loja")
                Text("Peça o vínculo. A loja confere seu cadastro e aprova pelo painel.",
                    style = MaterialTheme.typography.bodyLarge)
                card.message?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
                Primary(if (card.phase == InvitePhase.Sending) "Enviando…" else "Pedir vínculo", busy || card.phase == InvitePhase.Sending, actions.request)
                TextButton(onClick = actions.dismiss, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) { Text("Agora não") }
            }
            InvitePhase.Failed -> {
                Heading(name ?: "Convite")
                card.message?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
                if (card.retry) Secondary("Tentar novamente", busy, actions.retry)
                TextButton(onClick = actions.dismiss, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) { Text("Fechar") }
            }
        }
    }
}

@Composable
private fun ShiftContent(shift: Shift, busy: Boolean, actions: WorkActions) {
    Card {
        when (shift.status) {
            "PENDING" -> {
                Heading("Aguardando a loja", shift.restaurantName)
                Text("Seu turno foi pedido. Assim que a loja aprovar, você entra na fila.", style = MaterialTheme.typography.bodyLarge)
                Secondary("Cancelar pedido de turno", busy) { actions.endShift(shift) }
            }
            "AVAILABLE" -> {
                Heading("Você está na fila", shift.restaurantName, "Disponível")
                shift.queuePosition?.let { position ->
                    Surface(color = SoftGreen, contentColor = Green, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text("${position}º", fontSize = 40.sp, fontWeight = FontWeight.SemiBold)
                            Text(if (position == 1) "Você é o próximo da fila" else "da fila", style = MaterialTheme.typography.titleMedium)
                        }
                    }
                }
                Text("Quando a loja montar sua rota, ela aparece aqui sozinha.", style = MaterialTheme.typography.bodyLarge)
                EndShift(shift, busy, actions)
            }
            else -> {
                Heading("Atualizando seu turno…", shift.restaurantName)
            }
        }
    }
}

/**
 * "Pronto para os avisos": what makes the queue alerts reach a phone in the pocket. Each item that
 * is off has a button that fixes it on the spot; it reads again when the courier comes back.
 */
@Composable
private fun ReadyChecks(withBubble: Boolean = false) {
    val context = LocalContext.current
    var checks by remember { mutableIntStateOf(0) }
    LifecycleResumeEffect(Unit) { checks++; onPauseOrDispose { } }
    val notificationsOn = remember(checks) { NotificationManagerCompat.from(context).areNotificationsEnabled() }
    val locationOn = remember(checks) { hasLocation(context) }
    val batteryFree = remember(checks) {
        (context.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(context.packageName)
    }
    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { checks++ }
    val askLocation = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { checks++ }
    fun open(intent: Intent) { try { context.startActivity(intent) } catch (_: ActivityNotFoundException) { } }
    Card {
        Heading("Pronto para os avisos")
        CheckRow("Notificações", "Toca quando você for o próximo e quando a rota for liberada.", notificationsOn) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
            else open(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
        }
        CheckRow("Localização", "Só durante a rota, para o cliente ver você chegando.", locationOn) {
            askLocation.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
        }
        CheckRow("Uso de bateria", "Sem restrição, o aviso chega com a tela apagada.", batteryFree,
            on = "sem restrição", off = "restrito") { askBatteryExemption(context) }
        val wakeOn = remember(checks) { PickupWake.allowed(context) }
        CheckRow("Abrir na liberação", "Quando a loja liberar a retirada, a tela acende e o app abre na rota.", wakeOn) {
            PickupWake.settings(context)?.let(::open)
        }
        if (notificationsOn && locationOn && batteryFree && wakeOn)
            Text("Tudo certo: você recebe os avisos com a tela apagada.", style = MaterialTheme.typography.bodyMedium, color = Green)
        // Optional, so only in Avisos e permissões: the queue shows what the alerts need, nothing more.
        if (withBubble) {
            val bubbleOn = remember(checks) { RouteBubble.allowed(context) }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            CheckRow("Sobrepor outros apps", "Opcional. Na rota, um botão redondo fica sobre o Maps e volta para o app com um toque. " +
                "E se você estiver em outro app quando a retirada for liberada, o RpmDelivery abre sozinho.", bubbleOn) {
                open(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, "package:${context.packageName}".toUri()))
            }
        }
    }
}

@Composable
private fun CheckRow(title: String, why: String, ok: Boolean, on: String = "ligado", off: String = "desligado", fix: () -> Unit) {
    Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { }, verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Surface(shape = CircleShape, color = if (ok) SoftGreen else SoftCoral, contentColor = if (ok) Green else Coral,
            modifier = Modifier.size(28.dp)) {
            Box(contentAlignment = Alignment.Center) { Text(if (ok) "✓" else "!", fontWeight = FontWeight.Bold) }
        }
        Column(Modifier.weight(1f)) {
            Text("$title · ${if (ok) on else off}", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
            Text(why, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (!ok) TextButton(onClick = fix, modifier = Modifier.heightIn(min = 48.dp)) { Text("Ativar") }
    }
}

/** "Seu dia": since when the courier waits, and today's earnings split into encosta and deliveries. */
@Composable
private fun YourDay(today: Today, shift: Shift, onHistory: () -> Unit) {
    Card {
        Heading("Seu dia")
        if (shift.status == "AVAILABLE") clockTime(shift.availableSince)?.let {
            DayLine("Na fila desde", it)
        }
        DayLine("Entregas hoje", "${today.deliveries}")
        DayLine("Encosta", reais(today.shiftFeeCents))
        DayLine("Entregas", reais(today.deliveryFeesCents))
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        DayLine("A receber hoje", reais(today.totalCents), strong = true)
        TextButton(onClick = onHistory, modifier = Modifier.heightIn(min = 48.dp)) { Text("Ver histórico") }
    }
}

@Composable
private fun DayLine(label: String, value: String, strong: Boolean = false) {
    Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { }, horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyLarge, fontWeight = if (strong) FontWeight.Bold else FontWeight.Medium)
    }
}

/**
 * Ending the shift happens once, at the end of the day: a quiet link at the foot of the card,
 * confirmed in a dialog, so a stray tap never takes the courier out of line.
 */
@Composable
private fun EndShift(shift: Shift, busy: Boolean, actions: WorkActions) {
    var confirming by remember { mutableStateOf(false) }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    TextButton(onClick = { confirming = true }, enabled = !busy,
        colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.onSurfaceVariant),
        modifier = Modifier.heightIn(min = 48.dp)) {
        Text("Encerrar turno", style = MaterialTheme.typography.bodyMedium)
    }
    if (confirming) AlertDialog(
        onDismissRequest = { confirming = false },
        title = { Text("Encerrar o turno?") },
        text = { Text("Você sai da fila de ${shift.restaurantName}. Para voltar, peça um novo turno na loja.") },
        confirmButton = {
            TextButton(onClick = { confirming = false; actions.endShift(shift) }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Sim, encerrar") }
        },
        dismissButton = {
            TextButton(onClick = { confirming = false }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Continuar na fila") }
        },
    )
}

// ---------------------------------------------------------------- route

@Composable
private fun RouteContent(route: CourierRoute, shift: Shift?, busy: Boolean, actions: WorkActions, withStops: Boolean = true,
    /** The last refusal, shown under the swipe that caused it. */
    refusal: String? = null) {
    var failing by remember(route.nextDeliveryId) { mutableStateOf(false) }
    val total = route.stops.size
    val storeName = route.store.name.ifBlank { shift?.restaurantName.orEmpty() }
    Card {
        when (route.status) {
            "PREPARING" -> {
                Heading("Rota em preparação", "$storeName · ${entregas(total)}", if (route.pickupReleased) "Liberada" else null)
                if (route.pickupReleased) {
                    Banner("Retirada liberada. Pegue os pedidos e inicie a rota.", SoftGreen, Green)
                    SwipeToConfirm("Deslize para iniciar a rota", busy, SoftCoral, Coral, Coral, busyLabel = "Iniciando a rota…") { actions.startRoute(route) }
                    Refusal(refusal)
                } else {
                    Text("A loja está separando os pedidos. Aguarde a liberação da retirada.", style = MaterialTheme.typography.bodyLarge)
                    Refusal(refusal)
                }
            }
            "RETURNING" -> {
                Heading("Volte para a loja", storeName, "Retornando")
                Text(buildString {
                    append(entregues(route.delivered))
                    if (route.toReturn > 0) append(" · ${route.toReturn} para devolver na loja")
                }, style = MaterialTheme.typography.bodyLarge)
                route.store.address?.let { address ->
                    NavigationButton("Navegar até a loja", address) {
                        actions.navigate(mapQuery(route.store.latitude, route.store.longitude, address))
                    }
                }
                Text("Com a localização ligada, você entra na fila sozinho ao chegar na loja, na hora em que chegou. Sem localização, deslize abaixo.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                SwipeToConfirm("Deslize quando chegar na loja", busy, SoftCoral, Coral, Coral, busyLabel = "Registrando chegada…") { actions.arrive(route) }
                Refusal(refusal)
            }
            else -> {
                Heading("Minha rota", "Entrega ${minOf(route.settled + 1, total)} de $total", "Em rota")
                LocationOff(actions)
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                // Delivered (or reported): the stop leaves to the left, the way the thumb went, and the
                // next one comes in from the right. The leaving stop keeps its ✓ swipe while it goes.
                val motion = rememberMotion()
                AnimatedContent(targetState = route.next, contentKey = { it?.deliveryId }, label = "next-stop",
                    transitionSpec = {
                        if (!motion) EnterTransition.None togetherWith ExitTransition.None
                        else (slideInHorizontally(tween(320)) { it } + fadeIn(tween(320))) togetherWith
                            (slideOutHorizontally(tween(320)) { -it } + fadeOut(tween(220)))
                    }) { next ->
                    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        if (next == null) {
                            Text("A loja está decidindo o que fazer com a entrega que não deu certo. Se ela não decidir em 10 minutos, você volta com o pedido para a loja. A tela se atualiza sozinha.",
                                style = MaterialTheme.typography.bodyLarge)
                            Refusal(refusal)
                        } else if (failing) {
                            NextStop(next)
                            FailureForm(busy, onBack = { failing = false },
                                onSend = { reason, notes -> failing = false; actions.fail(route, next, reason, notes) })
                            Refusal(refusal)
                        } else {
                            NextStop(next)
                            NavigationButton("Abrir navegação", "Google Maps, Waze ou o aplicativo de mapas instalado") {
                                actions.navigate(mapQuery(next.latitude, next.longitude, stopSearch(next.address, next.neighborhood)))
                            }
                            // The swipe is the confirmation: no extra dialog between the courier and the next stop.
                            SwipeToConfirm("Deslize para confirmar a entrega", busy, SoftGreen, Green, Green,
                                busyLabel = "Confirmando entrega…") { actions.complete(route, next) }
                            Refusal(refusal)
                            // A quiet link, set apart from the swipe: the exception never competes with "delivered".
                            // A stray tap only opens the reason form, which still needs "Enviar para a loja".
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            TextButton(onClick = { failing = true }, enabled = !busy,
                                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.onSurfaceVariant),
                                modifier = Modifier.heightIn(min = 48.dp)) {
                                Text("Não consegui entregar", style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                }
            }
        }
        // On the street the stops and the store's phone live in the bottom sheet.
        if (withStops) {
            if (route.stops.isNotEmpty()) StopList(route)
            route.store.phone?.let { phone ->
                TextButton(onClick = { actions.dial(phone) }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Ligar para a loja") }
            }
        }
    }
}

/** False when the phone's "remove animations" setting is on: screens then change without movement. */
@Composable
private fun rememberMotion(): Boolean {
    val context = LocalContext.current
    return remember {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) > 0f
    }
}

/** Without location the route goes on, but the next customer's map shows no courier: say so, and offer to allow it. */
@Composable
private fun LocationOff(actions: WorkActions) {
    if (actions.locationOn) return
    Surface(color = SoftCoral, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(start = 14.dp, top = 12.dp, end = 6.dp, bottom = 4.dp)) {
            Text("Localização desligada: o cliente que é o próximo não vê você no mapa.", style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            TextButton(onClick = actions.askLocation, modifier = Modifier.heightIn(min = 48.dp)) { Text("Permitir localização") }
        }
    }
}

private fun entregas(count: Int) = if (count == 1) "1 entrega" else "$count entregas"
private fun entregues(count: Int) = if (count == 1) "1 entregue" else "$count entregues"

@Composable
private fun NextStop(stop: Stop) {
    Column(Modifier.testTag("next-stop"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        stop.reference?.let {
            Text("Pedido #$it", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(stop.customerName, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text(stop.address, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium)
        stop.complement?.let { Text(it, style = MaterialTheme.typography.bodyLarge) }
        val details = listOfNotNull(stop.neighborhood, clockTime(stop.deadlineAt)?.let { "Prazo $it" },
            if (stop.attempts > 0) "${stop.attempts + 1}ª tentativa" else null)
        if (details.isNotEmpty()) Text(details.joinToString(" · "), style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        stop.notes?.let {
            Surface(color = SoftCoral, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                Text("Observação: $it", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(12.dp))
            }
        }
    }
}

@Composable
private fun StopList(route: CourierRoute) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Text("Entregas da rota", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.semantics { heading() })
        StopRows(route)
    }
}

@Composable
private fun StopRows(route: CourierRoute) {
    // Read at arm's length, often in the sun: the address is body size, not fine print.
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        route.stops.forEach { stop ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(stop.customerName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(listOfNotNull(stop.address, stop.neighborhood).joinToString(" · "), style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(stopLabel(stop), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold,
                    color = if (stop.status == "NEXT") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/**
 * The failure report in place of the stop's actions, not in a dialog: the keyboard has the
 * whole screen, also at 320 px with large font, and the stop stays visible above it.
 */
@Composable
private fun FailureForm(busy: Boolean, onBack: () -> Unit, onSend: (FailureReason, String) -> Unit) {
    var reason by remember { mutableStateOf<FailureReason?>(null) }
    var notes by remember { mutableStateOf("") }
    val trimmed = notes.trim()
    val valid = reason != null && trimmed.length <= 500 && (reason != FailureReason.OTHER || trimmed.length >= 3)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Text("Por que não deu para entregar?", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.semantics { heading() })
        Column(Modifier.selectableGroup()) {
            FailureReason.entries.forEach { option ->
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .selectable(selected = reason == option, onClick = { reason = option }, role = Role.RadioButton),
                    verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(selected = reason == option, onClick = null)
                    Spacer(Modifier.width(8.dp))
                    Text(option.label, style = MaterialTheme.typography.bodyLarge)
                }
            }
        }
        OutlinedTextField(value = notes, onValueChange = { if (it.length <= 500) notes = it },
            label = { Text(if (reason == FailureReason.OTHER) "O que aconteceu? (obrigatório)" else "Detalhes para a loja (opcional)") },
            modifier = Modifier.fillMaxWidth())
        Text("A loja decide se você tenta de novo, devolve o pedido ou cancela.", style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = { reason?.let { onSend(it, trimmed) } }, enabled = valid && !busy, shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
            Text("Enviar para a loja", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
        Secondary("Voltar", busy, onBack)
    }
}

// ---------------------------------------------------------------- side menu parts

/** Every store link: approved ones work on Início; pending ones wait for the store. Another store's invite starts here too. */
@Composable
private fun StoresDirectory(state: WorkState, actions: WorkActions, onBack: () -> Unit) {
    val stores = state.home?.stores.orEmpty()
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Feedback(state)
        Card {
            Heading("Estabelecimentos", "Lojas em que você trabalha ou pediu para trabalhar")
            when {
                state.home == null -> Text("Carregando suas lojas…")
                stores.isEmpty() -> Text("Nenhuma loja ainda. Leia o QR Code do convite que a loja mostra no painel.",
                    style = MaterialTheme.typography.bodyLarge)
                else -> stores.sortedBy { !it.active }.forEach { store ->
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { }, verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(store.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        StatusChip(if (store.active) "Aprovado" else "Aguardando a loja", store.active)
                    }
                    if (store.active) StoreContactLine(store, actions)
                }
            }
            Primary(if (stores.isEmpty()) "Ler QR Code do convite" else "Ler convite de outra loja", state.busy, actions.invite.scan)
            InviteCodeEntry(state.busy, actions.invite.enter)
        }
        val refused = state.home?.refusedStores.orEmpty()
        if (refused.isNotEmpty()) Card {
            Heading("Vínculos recusados", "A loja não aprovou ou suspendeu o seu vínculo")
            refused.forEach { store ->
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { }, verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text(store.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        store.since?.let { Text("Desde ${historyDate(it.take(10))}", style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                    StatusChip(if (store.suspended) "Suspenso" else "Recusado", false)
                }
            }
            Text("Se foi engano, fale com a loja e peça um novo convite.", style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Secondary("Voltar ao início", false, onBack)
    }
}

/** An approved store's address, with a call and the way there. Nothing shows for what the store never filled in. */
@Composable
private fun StoreContactLine(store: Store, actions: WorkActions) {
    val address = store.address?.takeIf { it.isNotBlank() }
    val canNavigate = address != null || (store.latitude != null && store.longitude != null)
    if (address == null && store.phone == null) return
    val phone = store.phone?.let { BrazilianPhone.format(it.removePrefix("+55")) }
    Text(listOfNotNull(address, phone).joinToString(" · "), style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        store.phone?.let { number ->
            OutlinedButton(onClick = { actions.dial(number) }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                .semantics { contentDescription = "Ligar para ${store.name}" }) { Text("Ligar", maxLines = 1) }
        }
        if (canNavigate) OutlinedButton(onClick = { actions.navigate(mapQuery(store.latitude, store.longitude, address.orEmpty())) },
            modifier = Modifier.weight(1f).heightIn(min = 48.dp).semantics { contentDescription = "Como chegar em ${store.name}" }) {
            Text("Como chegar", maxLines = 1)
        }
    }
}

@Composable
private fun StatusChip(text: String, ok: Boolean) {
    Surface(color = if (ok) SoftGreen else MaterialTheme.colorScheme.surfaceVariant,
        contentColor = if (ok) Green else MaterialTheme.colorScheme.onSurfaceVariant, shape = RoundedCornerShape(100.dp)) {
        Text(text, modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp), style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold)
    }
}

/** What the stores see when they approve a link. Read only: the server keeps saved data as it is. */
@Composable
private fun ProfileContent(
    registration: CourierRegistration, state: WorkState, onDelete: () -> Unit, onBack: () -> Unit,
    onPhoto: (suspend () -> ByteArray?) -> Unit = {}, onRemovePhoto: () -> Unit = {},
) {
    var confirmDelete by remember { mutableStateOf(false) }
    var confirmRemove by remember { mutableStateOf(false) }
    val resolver = LocalContext.current.contentResolver
    // The system photo picker: no storage permission, the courier only shares the one image chosen.
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) onPhoto { withContext(Dispatchers.Default) { ProfilePhoto.squareJpeg(resolver, uri) } }
    }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Feedback(state)
        Card {
            Heading("Meu cadastro", "O que a loja vê ao aprovar seu vínculo")
            ProfilePicture(registration.name, state.photo)
            Secondary(when {
                state.photoSaving -> "Enviando foto…"
                state.photo != null -> "Trocar foto"
                else -> "Adicionar foto"
            }, state.photoSaving || state.photoLoading) {
                picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }
            if (state.photo != null) TextButton(onClick = { confirmRemove = true }, enabled = !state.photoSaving,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Remover foto") }
            Text("Use uma foto do seu rosto, de frente. Ela aparece para as lojas em que você trabalha.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            DayLine("Nome", registration.name.ifBlank { "—" })
            DayLine("Celular", if (registration.hasStoredPhone) BrazilianPhone.format(registration.phone.removePrefix("+55")) else "Não informado")
            DayLine("Moto", registration.model.ifBlank { "—" })
            DayLine("Placa", registration.plate.ifBlank { "—" })
            DayLine("Cor", registration.color.ifBlank { "—" })
            Text("Ainda não dá para alterar estes dados pelo aplicativo.", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Secondary("Voltar ao início", false, onBack)
        // Quiet, at the bottom, and always behind a confirmation: it cannot be undone.
        TextButton(onClick = { confirmDelete = true }, enabled = !state.busy,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text(if (state.busy) "Excluindo a conta…" else "Excluir minha conta", color = MaterialTheme.colorScheme.error)
        }
    }
    if (confirmRemove) AlertDialog(onDismissRequest = { confirmRemove = false },
        title = { Text("Remover sua foto?") },
        text = { Text("As lojas voltam a ver só as suas iniciais.") },
        confirmButton = {
            TextButton(onClick = { confirmRemove = false; onRemovePhoto() }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Remover") }
        },
        dismissButton = {
            TextButton(onClick = { confirmRemove = false }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Cancelar") }
        })
    if (confirmDelete) AlertDialog(onDismissRequest = { confirmDelete = false },
        title = { Text("Excluir sua conta?") },
        text = {
            Text("Apagamos seu nome, celular, dados da moto, seu histórico de localização e seu acesso ao aplicativo. " +
                "As lojas guardam só o registro das entregas e dos valores, sem o seu nome. Não dá para desfazer.")
        },
        confirmButton = {
            TextButton(onClick = { confirmDelete = false; onDelete() }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text("Excluir conta", color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = { confirmDelete = false }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Cancelar") }
        })
}

/** The courier's photo in a circle, or the initials while there is none. */
@Composable
private fun ProfilePicture(name: String, photo: ByteArray?) {
    val image = remember(photo) {
        photo?.let { runCatching { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }.getOrNull() }
    }
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        if (image != null) Image(image, contentDescription = "Sua foto", contentScale = ContentScale.Crop,
            modifier = Modifier.size(112.dp).clip(CircleShape).testTag("profile-photo"))
        else Box(Modifier.size(112.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)
            .semantics { contentDescription = "Sem foto" }, contentAlignment = Alignment.Center) {
            Text(initials(name), fontSize = 34.sp, fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** "Ana Paula Souza" → "AS"; "?" without a name. */
internal fun initials(name: String): String {
    val words = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    if (words.isEmpty()) return "?"
    val first = words.first().take(1)
    val last = if (words.size > 1) words.last().take(1) else ""
    return (first + last).uppercase(java.util.Locale.forLanguageTag("pt-BR"))
}

@Composable
private fun AlertsContent(onBack: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        ReadyChecks(withBubble = true)
        Text("Os avisos chegam quando a loja aprova seu turno, quando você é o próximo da fila e quando a rota é liberada. A localização só é usada durante a rota.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Secondary("Voltar ao início", false, onBack)
    }
}

private val helpTopics = listOf(
    "A loja não aparece em Início" to "Ela aparece depois que a loja aprovar seu vínculo no painel. Em Estabelecimentos você vê se ainda está aguardando.",
    "Pedi turno e nada aconteceu" to "A loja precisa aprovar o turno no painel. Você recebe um aviso quando ela aprovar.",
    "Não recebo os avisos" to "Abra Avisos e permissões e ative o que estiver desligado. Sem restrição de bateria, o aviso chega com a tela apagada.",
    "O cliente não vê a moto no mapa" to "O mapa usa sua localização só durante a rota. Permita a localização em Avisos e permissões.",
    "Como recebo meus ganhos?" to "Os valores seguem as taxas da loja: encosta uma vez por dia e cada entrega concluída. O pagamento é combinado com a loja.",
)

@Composable
private fun HelpContent(onBack: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Card {
            Heading("Ajuda")
            helpTopics.forEachIndexed { index, (question, answer) ->
                if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Column(Modifier.semantics(mergeDescendants = true) { }, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(question, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    Text(answer, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Text("Em dúvida durante uma rota, ligue para a loja pela lista de entregas.", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Secondary("Voltar ao início", false, onBack)
    }
}
