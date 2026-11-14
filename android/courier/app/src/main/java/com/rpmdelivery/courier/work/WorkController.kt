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
)

/**
 * The courier's shift and route. Reads every [refreshMillis] while the screen is shown and the app is in
 * the foreground, and right after each command. No background work.
 */
class WorkController(
    private val repository: CourierWorkRepository,
    private val scope: CoroutineScope,
    private val onExpired: () -> Unit,
    private val refreshMillis: Long = 15_000,
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
        } else { polling?.cancel(); polling = null }
    }

    fun refresh() { scope.launch { load() } }
    /** A new account starts from an empty screen. */
    fun clear() { requestIds.clear(); mutable.value = WorkState() }
    fun inform(message: String) = mutable.update { it.copy(message = message, notice = null) }

    fun requestShift(store: Store) = act("Turno pedido em ${store.name}. Aguarde a loja aprovar.") {
        repository.requestShift(store.restaurantId)
    }
    fun endShift(shift: Shift) = act(if (shift.status == "PENDING") "Pedido de turno cancelado." else "Turno encerrado.") {
        repository.endShift(shift.shiftId)
    }
    fun startRoute(route: CourierRoute) = act("Rota iniciada. Boa entrega!") {
        repository.startRoute(route.routeId, route.version)
        scope.launch {
            try { repository.notifyCustomers(route.routeId) }
            catch (error: CancellationException) { throw error }
            catch (_: Exception) { /* The store can resend; the route goes on. */ }
        }
    }
    fun completeDelivery(route: CourierRoute, stop: Stop) = act("Entrega concluída.") {
        once("complete:${stop.deliveryId}") { repository.completeDelivery(it, route.routeId, stop.deliveryId) }
    }
    fun reportFailure(route: CourierRoute, stop: Stop, reason: FailureReason, notes: String) =
        act("Ocorrência enviada. A loja decide o que fazer com este pedido.") {
            once("failure:${stop.deliveryId}:${stop.attempts}") {
                repository.reportFailure(it, route.routeId, stop.deliveryId, reason, notes)
            }
        }
    fun arriveAtStore(route: CourierRoute) = act("Chegada registrada. Você voltou para a fila.") {
        repository.arriveAtStore(route.routeId)
    }

    private suspend fun once(key: String, command: suspend (String) -> Unit) {
        val id = requestIds.getOrPut(key) { UUID.randomUUID().toString() }
        command(id)
        requestIds.remove(key)
    }

    /** [afterCommand]: the read that follows a command keeps its notice or refusal on screen. */
    private suspend fun load(afterCommand: Boolean = false) = reads.withLock {
        try {
            val home = repository.home()
            mutable.update {
                // Once the store changes something, an older notice or refusal no longer describes the screen.
                val stale = it.home == null || (!afterCommand && home != it.home)
                it.copy(home = home, loading = false, offline = false,
                    message = if (stale) null else it.message, notice = if (stale) null else it.notice)
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

    private fun act(success: String, command: suspend () -> Unit) {
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
                if (!expired) mutable.update { it.copy(message = error.safeMessage) }
            } catch (_: Exception) {
                mutable.update { it.copy(message = WorkCopy.GENERIC) }
            } finally { mutable.update { it.copy(busy = false) } }
            if (expired) expire() else load(afterCommand = true)
        }
    }

    private fun expire() {
        polling?.cancel(); polling = null
        mutable.value = WorkState()
        onExpired()
    }
}
