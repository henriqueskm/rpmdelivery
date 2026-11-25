package com.rpmdelivery.courier.work

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.UUID

data class WorkState(
    val home: CourierHome? = null,
    val loading: Boolean = true,
    val busy: Boolean = false,
    /** The last read failed for lack of connection; [home] is the last known screen. */
    val offline: Boolean = false,
    /** A refusal or failure the courier must read. */
    val message: String? = null,
    /** What just worked. */
    val notice: String? = null,
    /** Which part of the app is on screen, chosen in the side menu. */
    val section: Section = Section.Home,
    /** Earnings history: read only when the courier opens it; [historyError] when it could not be read. */
    val history: List<HistoryDay>? = null,
    val historyLoading: Boolean = false,
    val historyError: String? = null,
    /** A store's invite from a QR Code, a link or a typed code. Survives sign-in, never a restart. */
    val invite: InviteCard? = null,
    /** "Entregue" far from the address: the courier confirms or not. */
    val farPrompt: FarPrompt? = null,
    /** Meu cadastro: the courier's photo (JPEG), read when the section opens; null without one. */
    val photo: ByteArray? = null,
    val photoLoading: Boolean = false,
    /** Sending or removing the photo. */
    val photoSaving: Boolean = false,
) {
    val historyOpen: Boolean get() = section == Section.Earnings
}

/** The question shown when "entregue" comes from too far: who the delivery is for and how far the phone was. */
data class FarPrompt(val customerName: String, val meters: Int)

/**
 * The side menu. [Home] follows the courier's moment: invite, stores, line or route.
 * The others are looked at off the street and never change the shift.
 */
enum class Section(val label: String) {
    Home("Início"),
    Stores("Estabelecimentos"),
    Earnings("Ganhos"),
    Profile("Meu cadastro"),
    Alerts("Avisos e permissões"),
    Help("Ajuda"),
}

/** The route closed on the way back without a swipe: the server saw the courier at the store by GPS. */
const val ARRIVED_BY_GPS = "Chegada na loja registrada pela localização. Você voltou para a fila."

/**
 * The courier's shift and route. Reads every [refreshMillis] while the screen is shown and the app is in
 * the foreground, and right after each command. No background work.
 */
class WorkController(
    private val repository: CourierWorkRepository,
    private val scope: CoroutineScope,
    private val onExpired: () -> Unit,
    private val refreshMillis: Long = 15_000,
    /** The account was erased on the server: sign out of this phone and say so. */
    private val onAccountDeleted: () -> Unit = {},
) {
    private val mutable = MutableStateFlow(WorkState())
    val state = mutable.asStateFlow()
    private val reads = Mutex()
    private var polling: Job? = null
    private var foreground = true
    private var shown = false
    /** Request ids of commands that may have reached the server; reused on retry so nothing is applied twice. */
    private val requestIds = mutableMapOf<String, String>()

    fun setForeground(value: Boolean) { foreground = value; sync() }
    fun setShown(value: Boolean) { shown = value; sync() }
    private fun sync() {
        if (foreground && shown) {
            if (polling?.isActive != true) polling = scope.launch {
                while (isActive) { load(); delay(refreshMillis) }
            }
            checkInvite()
        } else { polling?.cancel(); polling = null }
    }

    fun refresh() { scope.launch { load() } }
    /** A new account starts from an empty screen. An invite that arrived before signing in waits for it. */
    fun clear() { requestIds.clear(); mutable.value = WorkState(invite = keptInvite()) }

    // ------------------------------------------------------------ store invites

    /** In memory only: never in the UI state, saved state or logs. */
    private var inviteCode: String? = null
    private fun keptInvite() = inviteCode?.let { InviteCard(InvitePhase.Waiting) }

    /** An invite code (already normalized). It is checked as soon as the courier's day is on screen. */
    fun receiveInvite(code: String) {
        inviteCode = code
        // The invite card lives on Início: a QR Code read from anywhere lands there.
        mutable.update { it.copy(invite = InviteCard(InvitePhase.Waiting), section = Section.Home) }
        if (foreground && shown) checkInvite()
    }
    fun dismissInvite() { inviteCode = null; mutable.update { it.copy(invite = null) } }
    /** After a dropped connection or a completed profile. */
    fun retryInvite() {
        if (inviteCode == null || mutable.value.invite?.retry != true) return
        mutable.update { it.copy(invite = InviteCard(InvitePhase.Waiting)) }
        checkInvite()
    }

    private fun checkInvite() {
        val code = inviteCode ?: return
        if (mutable.value.invite?.phase != InvitePhase.Waiting) return
        mutable.update { it.copy(invite = InviteCard(InvitePhase.Checking)) }
        scope.launch {
            val card = try {
                val check = repository.inspectInvite(code)
                when {
                    !check.ok -> InviteCard(InvitePhase.Failed, message = InviteCopy.refusal(check.reason))
                    !check.registered -> InviteCard(InvitePhase.Failed, check.restaurantName, InviteCopy.refusal("profile_required"), retry = true)
                    else -> InviteCard(InvitePhase.Ready, check.restaurantName)
                }
            } catch (error: CancellationException) { throw error }
            catch (error: WorkProblem) {
                if (error.expired) { expire(); return@launch }
                InviteCard(InvitePhase.Failed, message = error.safeMessage, retry = true)
            } catch (_: Exception) { InviteCard(InvitePhase.Failed, message = WorkCopy.GENERIC, retry = true) }
            // A newer invite replaced this one while it was being checked.
            if (inviteCode == code) mutable.update { it.copy(invite = card) }
        }
    }

    /** Sends the request to the invite's store. Approved in the panel, the store then shows up here. */
    fun requestLink() {
        val code = inviteCode ?: return
        val card = mutable.value.invite ?: return
        if (card.phase != InvitePhase.Ready || mutable.value.busy) return
        mutable.update { it.copy(busy = true, message = null, notice = null, invite = card.copy(phase = InvitePhase.Sending, message = null)) }
        scope.launch {
            var expired = false
            try {
                val result = repository.requestMembership(code)
                if (result.ok) {
                    inviteCode = null
                    mutable.update { it.copy(invite = null, notice = InviteCopy.requested(card.restaurantName ?: "a loja", result.status)) }
                } else {
                    val retry = result.reason == "profile_required"
                    if (!retry) inviteCode = null
                    mutable.update { it.copy(invite = card.copy(phase = InvitePhase.Failed, message = InviteCopy.refusal(result.reason), retry = retry)) }
                }
            } catch (error: CancellationException) { throw error }
            catch (error: WorkProblem) {
                expired = error.expired
                // Nothing was confirmed: the same request can be sent again (the server never doubles it).
                if (!expired) mutable.update { it.copy(invite = card.copy(phase = InvitePhase.Ready, message = error.safeMessage)) }
            } catch (_: Exception) {
                mutable.update { it.copy(invite = card.copy(phase = InvitePhase.Ready, message = WorkCopy.GENERIC)) }
            } finally { mutable.update { it.copy(busy = false) } }
            if (expired) expire() else load(afterCommand = true)
        }
    }
    fun inform(message: String) = mutable.update { it.copy(message = message, notice = null) }

    /** Opens the history and reads it then; nothing about past days is read before that. */
    fun openHistory() {
        mutable.update { it.copy(section = Section.Earnings) }
        loadHistory()
    }
    fun closeHistory() = show(Section.Home)

    /** Opens a part of the side menu. Ganhos reads the history each time it opens. */
    fun show(section: Section) {
        if (section == Section.Earnings) openHistory()
        else mutable.update { it.copy(section = section) }
        if (section == Section.Profile) loadPhoto()
    }

    /** Reads the courier's own photo each time Meu cadastro opens. A failure just leaves the initials. */
    fun loadPhoto() {
        if (mutable.value.photoLoading || mutable.value.photoSaving) return
        mutable.update { it.copy(photoLoading = true) }
        scope.launch {
            try {
                val photo = repository.photo()
                mutable.update { it.copy(photo = photo, photoLoading = false) }
            } catch (error: CancellationException) { throw error }
            catch (error: WorkProblem) {
                mutable.update { it.copy(photoLoading = false) }
                if (error.expired) expire()
            } catch (_: Exception) { mutable.update { it.copy(photoLoading = false) } }
        }
    }

    /**
     * Sends a new photo. [read] turns the picked image into a square JPEG off the main thread;
     * null means the image could not be opened.
     */
    fun savePhoto(read: suspend () -> ByteArray?) {
        if (mutable.value.photoSaving) return
        mutable.update { it.copy(photoSaving = true, message = null, notice = null) }
        scope.launch {
            try {
                val jpeg = read() ?: throw WorkProblem.refused("PHOTO_UNREADABLE")
                repository.savePhoto(jpeg)
                mutable.update { it.copy(photo = jpeg, photoSaving = false, notice = "Foto salva. As lojas em que você trabalha já veem a nova foto.") }
            } catch (error: CancellationException) { throw error }
            catch (error: WorkProblem) {
                mutable.update { it.copy(photoSaving = false) }
                if (error.expired) expire() else mutable.update { it.copy(message = error.safeMessage) }
            } catch (_: Exception) {
                mutable.update { it.copy(photoSaving = false, message = WorkCopy.forCode("PHOTO_UNREADABLE")) }
            }
        }
    }

    fun removePhoto() {
        if (mutable.value.photoSaving) return
        mutable.update { it.copy(photoSaving = true, message = null, notice = null) }
        scope.launch {
            try {
                repository.removePhoto()
                mutable.update { it.copy(photo = null, photoSaving = false, notice = "Foto removida.") }
            } catch (error: CancellationException) { throw error }
            catch (error: WorkProblem) {
                mutable.update { it.copy(photoSaving = false) }
                if (error.expired) expire() else mutable.update { it.copy(message = error.safeMessage) }
            } catch (_: Exception) {
                mutable.update { it.copy(photoSaving = false, message = WorkCopy.GENERIC) }
            }
        }
    }

    /** Reads the last 30 days, each time the history opens or the courier retries. */
    fun loadHistory() {
        if (mutable.value.historyLoading) return
        mutable.update { it.copy(historyLoading = true, historyError = null) }
        scope.launch {
            try {
                val days = repository.history(30)
                mutable.update { it.copy(history = days, historyLoading = false) }
            } catch (error: CancellationException) { throw error }
            catch (error: WorkProblem) {
                if (error.expired) { expire(); return@launch }
                mutable.update { it.copy(historyLoading = false, historyError = error.safeMessage) }
            } catch (_: Exception) {
                mutable.update { it.copy(historyLoading = false, historyError = WorkCopy.GENERIC) }
            }
        }
    }

    fun requestShift(store: Store) = act("Turno pedido em ${store.name}. Aguarde a loja aprovar.") {
        repository.requestShift(store.restaurantId)
    }
    fun endShift(shift: Shift) = act(if (shift.status == "PENDING") "Pedido de turno cancelado." else "Turno encerrado.") {
        repository.endShift(shift.shiftId)
    }
    fun startRoute(route: CourierRoute) = act("Rota iniciada. Boa entrega!") {
        repository.startRoute(route.routeId, route.version)
        notifyCustomers(route.routeId)
    }
    /**
     * Far from the address the server holds the delivery and the courier is asked in [WorkState.farPrompt];
     * confirming sends the same request again with [confirmFar], and the store sees the distance.
     */
    fun completeDelivery(route: CourierRoute, stop: Stop, position: GpsPoint? = null, confirmFar: Boolean = false) =
        act("Entrega concluída.", onRefused = { problem ->
            if (problem.code != WorkProblem.FAR_FROM_ADDRESS || confirmFar) false
            else {
                farContext = Triple(route, stop, position)
                mutable.update { it.copy(farPrompt = FarPrompt(stop.customerName, problem.meters ?: 0)) }
                true
            }
        }) {
            once("complete:${stop.deliveryId}") { repository.completeDelivery(it, route.routeId, stop.deliveryId, position, confirmFar) }
            // The next customer is now first in line: "você é o próximo".
            notifyCustomers(route.routeId)
        }

    private var farContext: Triple<CourierRoute, Stop, GpsPoint?>? = null
    /** "Confirmar mesmo assim": the same request, now accepted far away and flagged for the store. */
    fun confirmFarDelivery() {
        val (route, stop, position) = farContext ?: return
        farContext = null
        mutable.update { it.copy(farPrompt = null) }
        completeDelivery(route, stop, position, confirmFar = true)
    }
    fun cancelFarDelivery() { farContext = null; mutable.update { it.copy(farPrompt = null) } }
    fun reportFailure(route: CourierRoute, stop: Stop, reason: FailureReason, notes: String) =
        act("Ocorrência enviada. A loja decide o que fazer com este pedido.") {
            once("failure:${stop.deliveryId}:${stop.attempts}") {
                repository.reportFailure(it, route.routeId, stop.deliveryId, reason, notes)
            }
            notifyCustomers(route.routeId)
        }

    /** Asks the server to send what the route queued ("saiu", "próximo"). Never blocks the route. */
    private fun notifyCustomers(routeId: String) {
        scope.launch {
            try { repository.notifyCustomers(routeId) }
            catch (error: CancellationException) { throw error }
            catch (_: Exception) { /* The store can resend; the route goes on. */ }
        }
    }
    /**
     * "Excluir minha conta", after the courier confirmed. A refusal (shift open, store login) stays on screen;
     * success ends everything here: no more reads, the session goes, and the sign-in screen says why.
     */
    fun deleteAccount() {
        if (mutable.value.busy) return
        mutable.update { it.copy(busy = true, message = null, notice = null) }
        scope.launch {
            try {
                repository.deleteAccount()
                polling?.cancel(); polling = null
                requestIds.clear(); inviteCode = null
                mutable.value = WorkState()
                onAccountDeleted()
            } catch (error: CancellationException) { throw error }
            catch (error: WorkProblem) {
                mutable.update { it.copy(busy = false) }
                if (error.expired) expire() else mutable.update { it.copy(message = error.safeMessage) }
            } catch (_: Exception) {
                mutable.update { it.copy(busy = false, message = WorkCopy.GENERIC) }
            }
        }
    }

    /** Far from the store the server refuses; the courier reads how far in [WorkState.message]. */
    fun arriveAtStore(route: CourierRoute, position: GpsPoint? = null) = act("Chegada registrada. Você voltou para a fila.") {
        repository.arriveAtStore(route.routeId, position)
    }

    /** Approved shift, on the way: the swipe "Cheguei na loja" puts the courier at the end of the line. */
    fun arriveForShift(position: GpsPoint? = null) = act("Chegada registrada. Você entrou na fila.") {
        repository.arriveForShift(position)
    }

    private suspend fun once(key: String, command: suspend (String) -> Unit) {
        val id = requestIds.getOrPut(key) { UUID.randomUUID().toString() }
        command(id)
        requestIds.remove(key)
    }

    /** [afterCommand]: the read that follows a command keeps its notice or refusal on screen. */
    private suspend fun load(afterCommand: Boolean = false) = reads.withLock {
        try {
            var home = repository.home()
            // Waiting for the store to decide an occurrence on the last stop: let the server close it once
            // its deadline passes (the route then heads back). Best effort; the next read tries again.
            val waiting = home.route?.takeIf { it.status == "ON_ROUTE" && it.nextDeliveryId == null }
            if (waiting != null) {
                val settled = try { repository.settleRoute(waiting.routeId); true }
                    catch (error: CancellationException) { throw error }
                    catch (_: Exception) { false }
                if (settled) home = repository.home()
            }
            val shown = home
            mutable.update {
                // Once the store changes something, an older notice or refusal no longer describes the screen.
                val stale = it.home == null || (!afterCommand && shown != it.home)
                // On the way back the route closed without a swipe: the GPS saw the courier at the store.
                val arrivedByGps = !afterCommand && it.home?.route?.status == "RETURNING" &&
                    shown.route?.routeId != it.home?.route?.routeId
                it.copy(home = shown, loading = false, offline = false,
                    message = if (stale) null else it.message,
                    notice = if (arrivedByGps) ARRIVED_BY_GPS else if (stale) null else it.notice)
            }
        } catch (error: CancellationException) { throw error }
        catch (error: WorkProblem) {
            if (error.expired) { expire(); return@withLock }
            mutable.update {
                // With a screen already shown, a dropped connection keeps it and says so.
                if (error.network && it.home != null) it.copy(loading = false, offline = true)
                else it.copy(loading = false, message = error.safeMessage)
            }
        } catch (_: Exception) {
            mutable.update { it.copy(loading = false, message = WorkCopy.GENERIC) }
        }
    }

    /** [onRefused]: a refusal the caller turns into its own screen (true) instead of a message. */
    private fun act(success: String, onRefused: (WorkProblem) -> Boolean = { false }, command: suspend () -> Unit) {
        if (mutable.value.busy) return
        mutable.update { it.copy(busy = true, message = null, notice = null) }
        scope.launch {
            var expired = false
            try {
                command()
                mutable.update { it.copy(notice = success) }
            } catch (error: CancellationException) { throw error }
            catch (error: WorkProblem) {
                expired = error.expired
                if (!expired && !onRefused(error)) mutable.update { it.copy(message = error.safeMessage) }
            } catch (_: Exception) {
                mutable.update { it.copy(message = WorkCopy.GENERIC) }
            } finally { mutable.update { it.copy(busy = false) } }
            if (expired) expire() else load(afterCommand = true)
        }
    }

    private fun expire() {
        polling?.cancel(); polling = null
        mutable.value = WorkState(invite = keptInvite())
        onExpired()
    }
}
