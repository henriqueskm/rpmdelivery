package com.rpmdelivery.courier.work

import com.rpmdelivery.courier.auth.AuthCopy
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.exceptions.RestException
import io.github.jan.supabase.postgrest.postgrest
import io.ktor.client.plugins.HttpRequestTimeoutException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

interface CourierWorkRepository {
    suspend fun home(): CourierHome
    suspend fun requestShift(restaurantId: String)
    suspend fun endShift(shiftId: String)
    suspend fun startRoute(routeId: String, version: Int)
    suspend fun completeDelivery(requestId: String, routeId: String, deliveryId: String)
    suspend fun reportFailure(requestId: String, routeId: String, deliveryId: String, reason: FailureReason, notes: String)
    suspend fun arriveAtStore(routeId: String)
    /** Sends 1 to 100 readings of the route in progress. */
    suspend fun recordLocations(routeId: String, points: List<GpsPoint>)
    /** Best effort: asks the server to send the customers' "saiu para entrega" messages. */
    suspend fun notifyCustomers(routeId: String)
}

class WorkProblem(val safeMessage: String, val code: String? = null) : Exception(safeMessage) {
    val expired: Boolean get() = code == EXPIRED
    val network: Boolean get() = code == NETWORK
    companion object {
        const val EXPIRED = "EXPIRED"
        const val NETWORK = "NETWORK"
        fun expired() = WorkProblem(AuthCopy.EXPIRED, EXPIRED)
        fun network() = WorkProblem(AuthCopy.NETWORK, NETWORK)
        /** Server refusals carry an RPM_* code; each becomes a sentence for the courier. */
        fun refused(code: String?) = WorkProblem(WorkCopy.forCode(code), code)
    }
}

object WorkCopy {
    const val GENERIC = "Não foi possível concluir. Tente novamente."
    const val UNEXPECTED = "O aplicativo recebeu uma resposta inesperada. Atualize e tente de novo."
    fun forCode(code: String?): String = when (code) {
        "RPM_PICKUP_NOT_RELEASED" -> "A loja ainda não liberou a retirada. Aguarde a liberação."
        "RPM_ROUTE_STALE" -> "A loja mudou a rota. Confira as entregas e inicie de novo."
        "RPM_ROUTE_STATE" -> "A rota mudou de situação. Confira a tela atualizada."
        "RPM_ROUTE_NOT_FOUND" -> "Esta rota não está mais com você. Fale com a loja."
        "RPM_DELIVERY_STATE", "RPM_DELIVERY_NOT_FOUND" -> "Esta entrega mudou; a loja pode ter cancelado. Confira a rota."
        "RPM_FAILURE_FIELDS" -> "Escolha o motivo. Em \"Outro motivo\", conte o que aconteceu (3 a 500 caracteres)."
        "RPM_COURIER_LINK_REQUIRED" -> "Seu vínculo com esta loja não está ativo. Fale com a loja."
        "RPM_COURIER_REGISTRATION_INCOMPLETE" -> "Complete seu cadastro de motoboy antes de pedir turno."
        "RPM_COURIER_REQUIRED" -> "Complete seu cadastro de motoboy para ver lojas e turnos."
        "RPM_SHIFT_OPEN_ELSEWHERE" -> "Você já tem um turno aberto em outra loja. Encerre aquele turno primeiro."
        "RPM_SHIFT_BUSY" -> "Não dá para encerrar o turno com uma rota em andamento."
        "RPM_SHIFT_NOT_AVAILABLE" -> "Seu turno não está disponível para iniciar a rota. Fale com a loja."
        "RPM_SHIFT_NOT_FOUND", "RPM_SHIFT_STATE" -> "Seu turno mudou. Confira a tela atualizada."
        else -> GENERIC
    }
}

private val RPM_CODE = Regex("RPM_[A-Z_]+")

/**
 * Courier commands over the same client and session as [com.rpmdelivery.courier.auth.SupabaseCourierAuth].
 * [gate] is shared with it, so a session refresh never races another refresh or command.
 */
class SupabaseCourierWork(
    private val client: SupabaseClient,
    private val gate: Mutex,
    private val projectUrl: String,
    private val publishableKey: String,
) : CourierWorkRepository {

    override suspend fun home(): CourierHome = parseHome(rpc("get_courier_home"))
    override suspend fun requestShift(restaurantId: String) {
        rpc("request_shift", buildJsonObject { put("p_restaurant_id", restaurantId) })
    }
    override suspend fun endShift(shiftId: String) {
        rpc("end_shift", buildJsonObject { put("p_shift_id", shiftId) })
    }
    override suspend fun startRoute(routeId: String, version: Int) {
        rpc("start_route", buildJsonObject { put("p_route_id", routeId); put("p_expected_version", version) })
    }
    override suspend fun completeDelivery(requestId: String, routeId: String, deliveryId: String) {
        rpc("complete_delivery", buildJsonObject {
            put("p_request_id", requestId); put("p_route_id", routeId); put("p_delivery_id", deliveryId)
        })
    }
    override suspend fun reportFailure(requestId: String, routeId: String, deliveryId: String, reason: FailureReason, notes: String) {
        rpc("report_delivery_failure", buildJsonObject {
            put("p_request_id", requestId); put("p_route_id", routeId); put("p_delivery_id", deliveryId)
            put("p_reason", reason.name); put("p_notes", notes.trim().ifEmpty { null })
        })
    }
    override suspend fun arriveAtStore(routeId: String) {
        rpc("arrive_at_store", buildJsonObject { put("p_route_id", routeId) })
    }
    override suspend fun recordLocations(routeId: String, points: List<GpsPoint>) {
        require(points.size in 1..100)
        rpc("record_courier_locations", buildJsonObject {
            put("p_route_id", routeId)
            put("p_points", buildJsonArray {
                points.forEach { point ->
                    add(buildJsonObject {
                        put("latitude", point.latitude); put("longitude", point.longitude)
                        put("accuracy", point.accuracy); put("recordedAt", point.recordedAt)
                    })
                }
            })
        })
    }

    override suspend fun notifyCustomers(routeId: String) {
        val token = client.auth.currentSessionOrNull()?.accessToken ?: return
        withContext(Dispatchers.IO) {
            val connection = URL("$projectUrl/functions/v1/dispatch-notifications").openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "POST"
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 10_000
                connection.readTimeout = 15_000
                connection.doOutput = true
                connection.setRequestProperty("Authorization", "Bearer $token")
                connection.setRequestProperty("apikey", publishableKey)
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(buildJsonObject { put("routeId", routeId) }.toString().toByteArray()) }
                // The answer only carries counts; a missing or failing function never blocks the route.
                connection.responseCode
            } finally { connection.disconnect() }
        }
    }

    private suspend fun rpc(name: String, args: JsonObject = buildJsonObject { }): JsonElement = gate.withLock {
        try {
            call(name, args)
        } catch (error: CancellationException) { throw error }
        catch (error: RestException) {
            if (error.statusCode != 401) throw translate(error)
            // Expired access token: renew it once, then repeat. A 401 means nothing was applied.
            try { client.auth.refreshCurrentSession() }
            catch (cancel: CancellationException) { throw cancel }
            catch (_: Exception) { client.auth.clearSession(); throw WorkProblem.expired() }
            try { call(name, args) }
            catch (cancel: CancellationException) { throw cancel }
            catch (retry: Exception) { throw translate(retry) }
        } catch (error: Exception) { throw translate(error) }
    }

    private suspend fun call(name: String, args: JsonObject): JsonElement {
        client.auth.awaitInitialization()
        if (client.auth.currentSessionOrNull() == null) throw WorkProblem.expired()
        val result = client.postgrest.rpc(name, args)
        return Json.parseToJsonElement(result.data.ifBlank { "null" })
    }

    private suspend fun translate(error: Exception): WorkProblem = when (error) {
        is WorkProblem -> error
        is RestException -> if (error.statusCode == 401) {
            client.auth.clearSession(); WorkProblem.expired()
        } else WorkProblem.refused(RPM_CODE.find(error.message.orEmpty())?.value)
        is IOException, is HttpRequestTimeoutException -> WorkProblem.network()
        else -> WorkProblem(WorkCopy.GENERIC)
    }
}

/** Unconfigured APKs never reach a hosted project. */
class UnconfiguredWork : CourierWorkRepository {
    private fun refuse(): Nothing = throw WorkProblem(AuthCopy.CONFIG)
    override suspend fun home(): CourierHome = refuse()
    override suspend fun requestShift(restaurantId: String) = refuse()
    override suspend fun endShift(shiftId: String) = refuse()
    override suspend fun startRoute(routeId: String, version: Int) = refuse()
    override suspend fun completeDelivery(requestId: String, routeId: String, deliveryId: String) = refuse()
    override suspend fun reportFailure(requestId: String, routeId: String, deliveryId: String, reason: FailureReason, notes: String) = refuse()
    override suspend fun arriveAtStore(routeId: String) = refuse()
    override suspend fun recordLocations(routeId: String, points: List<GpsPoint>) = refuse()
    override suspend fun notifyCustomers(routeId: String) = Unit
}
