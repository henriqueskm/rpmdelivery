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
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

interface CourierWorkRepository {
    suspend fun home(): CourierHome
    /** The courier's own earnings by day and store, newest first. */
    suspend fun history(days: Int = 30): List<HistoryDay>
    suspend fun requestShift(restaurantId: String)
    suspend fun endShift(shiftId: String)
    suspend fun startRoute(routeId: String, version: Int)
    /**
     * [position]: where the phone is now, checked against the address pin (more than 300 m: refused with
     * RPM_FAR_FROM_ADDRESS until [confirmFar]). Null when there is no fresh, real reading: never blocked.
     */
    suspend fun completeDelivery(requestId: String, routeId: String, deliveryId: String,
        position: GpsPoint? = null, confirmFar: Boolean = false)
    suspend fun reportFailure(requestId: String, routeId: String, deliveryId: String, reason: FailureReason, notes: String)
    /** More than 300 m from the store: refused with RPM_FAR_FROM_STORE. */
    suspend fun arriveAtStore(routeId: String, position: GpsPoint? = null)
    /**
     * Approved shift, on the way: enters the line at the store.
     * [auto]: the GPS saw the phone within 100 m (RPM_NOT_AT_STORE when the server disagrees).
     * Otherwise the swipe: more than 300 m away with a [position], refused with RPM_FAR_FROM_STORE.
     */
    suspend fun arriveForShift(position: GpsPoint? = null, auto: Boolean = false)
    /** Sends 1 to 100 readings of the route in progress. */
    suspend fun recordLocations(routeId: String, points: List<GpsPoint>)
    /** Best effort: asks the server to send the customers' "saiu para entrega" messages. */
    suspend fun notifyCustomers(routeId: String)
    /**
     * While the route waits for the store to decide an occurrence (nothing left to deliver): past the
     * decision deadline the server closes it and the route starts returning. Harmless before that.
     */
    suspend fun settleRoute(routeId: String)
    /** Which store an invite belongs to. Never changes anything. */
    suspend fun inspectInvite(code: String): InviteCheck
    /** Asks the invite's store for a link; the store approves it in the panel. Repeating it is harmless. */
    suspend fun requestMembership(code: String): InviteRequest
    /**
     * "Excluir minha conta": erases the courier's data and closes the login (Edge Function delete-account).
     * Refused with RPM_ACCOUNT_SHIFT_OPEN or RPM_ACCOUNT_STORE_MEMBER. Repeating it after a failure is safe.
     */
    suspend fun deleteAccount()
    /** The courier's own profile photo (JPEG), or null without one. */
    suspend fun photo(): ByteArray?
    /** Uploads or replaces the photo (a square JPEG), then marks it so the stores see it. */
    suspend fun savePhoto(jpeg: ByteArray)
    /** Deletes the photo and the mark. */
    suspend fun removePhoto()
}

/** [meters]: with RPM_FAR_FROM_ADDRESS / RPM_FAR_FROM_STORE, how far the phone was. */
class WorkProblem(val safeMessage: String, val code: String? = null, val meters: Int? = null) : Exception(safeMessage) {
    val expired: Boolean get() = code == EXPIRED
    val network: Boolean get() = code == NETWORK
    companion object {
        const val EXPIRED = "EXPIRED"
        const val NETWORK = "NETWORK"
        fun expired() = WorkProblem(AuthCopy.EXPIRED, EXPIRED)
        fun network() = WorkProblem(AuthCopy.NETWORK, NETWORK)
        /** Server refusals carry an RPM_* code; each becomes a sentence for the courier. */
        fun refused(code: String?) = WorkProblem(WorkCopy.forCode(code), code)
        const val FAR_FROM_ADDRESS = "RPM_FAR_FROM_ADDRESS"
        const val FAR_FROM_STORE = "RPM_FAR_FROM_STORE"
        private val FAR = Regex("(RPM_FAR_FROM_(?:ADDRESS|STORE)) ([0-9]{1,6})")
        /** A server refusal from its message; the distance ones carry their meters. */
        fun fromServer(message: String?): WorkProblem {
            val far = FAR.find(message.orEmpty())
            if (far != null) {
                val meters = far.groupValues[2].toInt()
                return WorkProblem(WorkCopy.far(far.groupValues[1], meters), far.groupValues[1], meters)
            }
            return refused(RPM_CODE.find(message.orEmpty())?.value)
        }
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
        "RPM_NOT_AT_STORE" -> "A localização ainda não mostra você na loja. Ao chegar, deslize \"Cheguei na loja\"."
        "RPM_ACCOUNT_SHIFT_OPEN" -> "Encerre o turno antes de excluir a conta."
        "RPM_ACCOUNT_STORE_MEMBER" -> "Este login também é de uma loja. Para excluir, use o painel da loja ou fale com o suporte."
        "DELETE_UNAVAILABLE" -> "Não foi possível excluir a conta agora. Tente de novo mais tarde."
        "PHOTO_UNAVAILABLE" -> "Não foi possível salvar a foto agora. Confira a internet e tente de novo."
        "PHOTO_UNREADABLE" -> "Não foi possível abrir esta imagem. Escolha outra foto."
        else -> GENERIC
    }
    fun far(code: String, meters: Int): String = if (code == WorkProblem.FAR_FROM_STORE)
        "Você está a ${distance(meters)} da loja. Deslize em \"cheguei\" quando estiver nela."
        else "Você está a ${distance(meters)} do endereço da entrega."
    /** "350 m", "1,2 km". */
    fun distance(meters: Int): String = if (meters < 1000) "${(meters + 5) / 10 * 10} m"
        else String.format(java.util.Locale.forLanguageTag("pt-BR"), "%.1f km", meters / 1000.0).replace(",0 km", " km")
}

private val RPM_CODE = Regex("RPM_[A-Z_]+")
/** Storage's answer to an expired access token ("jwt expired", "exp" claim check failed). */
private val EXPIRED_JWT = Regex("jwt expired|\"exp\" claim|token is expired", RegexOption.IGNORE_CASE)

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
    override suspend fun history(days: Int): List<HistoryDay> =
        parseHistory(rpc("get_courier_history", buildJsonObject { put("p_days", days) }))
    override suspend fun requestShift(restaurantId: String) {
        rpc("request_shift", buildJsonObject { put("p_restaurant_id", restaurantId) })
    }
    override suspend fun endShift(shiftId: String) {
        rpc("end_shift", buildJsonObject { put("p_shift_id", shiftId) })
    }
    override suspend fun startRoute(routeId: String, version: Int) {
        rpc("start_route", buildJsonObject { put("p_route_id", routeId); put("p_expected_version", version) })
    }
    override suspend fun completeDelivery(requestId: String, routeId: String, deliveryId: String,
        position: GpsPoint?, confirmFar: Boolean) {
        rpc("complete_delivery", buildJsonObject {
            put("p_request_id", requestId); put("p_route_id", routeId); put("p_delivery_id", deliveryId)
            position(position)
            if (confirmFar) put("p_confirm_far", true)
        })
    }
    /** Only with a reading: an absent position keeps the server's older behavior. */
    private fun kotlinx.serialization.json.JsonObjectBuilder.position(point: GpsPoint?) {
        if (point == null) return
        put("p_latitude", point.latitude); put("p_longitude", point.longitude)
        point.accuracy?.let { put("p_accuracy", it) }
    }
    override suspend fun reportFailure(requestId: String, routeId: String, deliveryId: String, reason: FailureReason, notes: String) {
        rpc("report_delivery_failure", buildJsonObject {
            put("p_request_id", requestId); put("p_route_id", routeId); put("p_delivery_id", deliveryId)
            put("p_reason", reason.name); put("p_notes", notes.trim().ifEmpty { null })
        })
    }
    override suspend fun arriveAtStore(routeId: String, position: GpsPoint?) {
        rpc("arrive_at_store", buildJsonObject { put("p_route_id", routeId); position(position) })
    }
    override suspend fun arriveForShift(position: GpsPoint?, auto: Boolean) {
        rpc("arrive_for_shift", buildJsonObject { position(position); put("p_auto", auto) })
    }
    override suspend fun recordLocations(routeId: String, points: List<GpsPoint>) {
        require(points.size in 1..100)
        // Outside the command gate: on a weak signal a GPS batch can take seconds, and "delivered" or
        // "back at the store" must never wait behind it. No refresh here either: a 401 just leaves the
        // points in the buffer for the next tick, after the app's own commands renew the session.
        background("record_courier_locations", buildJsonObject {
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

    override suspend fun inspectInvite(code: String): InviteCheck {
        val result = rpc("inspect_courier_invite", buildJsonObject { put("p_code", code) }) as? JsonObject
            ?: throw WorkProblem(WorkCopy.UNEXPECTED)
        return InviteCheck(result.flag("ok"), result.text("reason"), result.text("restaurantName"), result.flag("registered"))
    }
    override suspend fun requestMembership(code: String): InviteRequest {
        val result = rpc("request_courier_membership", buildJsonObject { put("p_code", code) }) as? JsonObject
            ?: throw WorkProblem(WorkCopy.UNEXPECTED)
        return InviteRequest(result.flag("ok"), result.text("reason"), result.text("status"))
    }
    private fun JsonObject.flag(key: String) = (get(key) as? JsonPrimitive)?.booleanOrNull == true
    private fun JsonObject.text(key: String) = (get(key) as? JsonPrimitive)?.contentOrNull

    override suspend fun settleRoute(routeId: String) {
        rpc("settle_courier_route", buildJsonObject { put("p_route_id", routeId) })
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

    override suspend fun deleteAccount() {
        client.auth.awaitInitialization()
        val token = client.auth.currentSessionOrNull()?.accessToken ?: throw WorkProblem.expired()
        val (status, body) = try {
            withContext(Dispatchers.IO) {
                val connection = URL("$projectUrl/functions/v1/delete-account").openConnection() as HttpURLConnection
                try {
                    connection.requestMethod = "POST"
                    connection.instanceFollowRedirects = false
                    connection.connectTimeout = 15_000
                    connection.readTimeout = 30_000
                    connection.doOutput = true
                    connection.setRequestProperty("Authorization", "Bearer $token")
                    connection.setRequestProperty("apikey", publishableKey)
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.outputStream.use { it.write("{}".toByteArray()) }
                    val code = connection.responseCode
                    val stream = if (code in 200..299) connection.inputStream else connection.errorStream
                    code to (stream?.bufferedReader()?.use { it.readText() }.orEmpty())
                } finally { connection.disconnect() }
            }
        } catch (error: CancellationException) { throw error }
        catch (_: IOException) { throw WorkProblem.network() }
        when (status) {
            in 200..299 -> return
            401 -> { client.auth.clearSession(); throw WorkProblem.expired() }
            409 -> throw WorkProblem.refused(RPM_CODE.find(body)?.value)
            else -> throw WorkProblem.refused("DELETE_UNAVAILABLE")
        }
    }

    override suspend fun photo(): ByteArray? {
        val (status, body) = storage("GET")
        return when (status) {
            in 200..299 -> body
            // No photo yet: Storage answers 400 (older versions) or 404 (newer).
            400, 404 -> null
            else -> throw WorkProblem.refused("PHOTO_UNAVAILABLE")
        }
    }

    override suspend fun savePhoto(jpeg: ByteArray) {
        val (status, _) = storage("POST", jpeg)
        if (status !in 200..299) throw WorkProblem.refused("PHOTO_UNAVAILABLE")
        rpc("set_courier_photo", buildJsonObject { put("p_has_photo", true) })
    }

    override suspend fun removePhoto() {
        val (status, _) = storage("DELETE")
        if (status !in 200..299 && status != 400 && status != 404) throw WorkProblem.refused("PHOTO_UNAVAILABLE")
        rpc("set_courier_photo", buildJsonObject { put("p_has_photo", false) })
    }

    /**
     * The photo file in the private bucket courier-photos, always at "<user id>/avatar.jpg".
     * An expired access token is renewed once (under [gate], like the RPCs) and the call repeated.
     */
    private suspend fun storage(method: String, body: ByteArray? = null): Pair<Int, ByteArray> {
        client.auth.awaitInitialization()
        val session = client.auth.currentSessionOrNull() ?: throw WorkProblem.expired()
        val userId = try { session.user?.id ?: client.auth.retrieveUserForCurrentSession().id }
            catch (error: CancellationException) { throw error }
            catch (_: Exception) { throw WorkProblem.network() }
        val path = "courier-photos/$userId/avatar.jpg"
        val url = if (method == "GET") "$projectUrl/storage/v1/object/authenticated/$path" else "$projectUrl/storage/v1/object/$path"
        var answer = send(url, method, session.accessToken, body)
        if (answer.first in setOf(400, 401, 403) && EXPIRED_JWT.containsMatchIn(answer.second.decodeToString())) {
            val token = gate.withLock {
                try { client.auth.refreshCurrentSession() }
                catch (error: CancellationException) { throw error }
                catch (_: Exception) { client.auth.clearSession(); throw WorkProblem.expired() }
                client.auth.currentSessionOrNull()?.accessToken ?: throw WorkProblem.expired()
            }
            answer = send(url, method, token, body)
        }
        return answer
    }

    private suspend fun send(url: String, method: String, token: String, body: ByteArray?): Pair<Int, ByteArray> = try {
        withContext(Dispatchers.IO) {
            val connection = URL(url).openConnection() as HttpURLConnection
            try {
                connection.requestMethod = method
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 15_000
                connection.readTimeout = 30_000
                connection.setRequestProperty("Authorization", "Bearer $token")
                connection.setRequestProperty("apikey", publishableKey)
                if (body != null) {
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "image/jpeg")
                    connection.setRequestProperty("x-upsert", "true")
                    connection.setRequestProperty("cache-control", "no-cache")
                    connection.outputStream.use { it.write(body) }
                }
                val code = connection.responseCode
                val stream = if (code in 200..299) connection.inputStream else connection.errorStream
                code to (stream?.use { it.readBytes() } ?: ByteArray(0))
            } finally { connection.disconnect() }
        }
    } catch (error: CancellationException) { throw error }
    catch (_: IOException) { throw WorkProblem.network() }

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

    /** Background traffic (GPS): never takes the gate, never renews or clears the session. */
    private suspend fun background(name: String, args: JsonObject): JsonElement = try {
        call(name, args)
    } catch (error: CancellationException) { throw error }
    catch (error: WorkProblem) { throw error }
    catch (error: RestException) {
        if (error.statusCode == 401) throw WorkProblem.network()
        throw WorkProblem.fromServer(error.message)
    } catch (_: IOException) { throw WorkProblem.network() }
    catch (_: HttpRequestTimeoutException) { throw WorkProblem.network() }
    catch (_: Exception) { throw WorkProblem(WorkCopy.GENERIC) }

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
        } else WorkProblem.fromServer(error.message)
        is IOException, is HttpRequestTimeoutException -> WorkProblem.network()
        else -> WorkProblem(WorkCopy.GENERIC)
    }
}

/** Unconfigured APKs never reach a hosted project. */
class UnconfiguredWork : CourierWorkRepository {
    private fun refuse(): Nothing = throw WorkProblem(AuthCopy.CONFIG)
    override suspend fun home(): CourierHome = refuse()
    override suspend fun history(days: Int): List<HistoryDay> = refuse()
    override suspend fun requestShift(restaurantId: String) = refuse()
    override suspend fun endShift(shiftId: String) = refuse()
    override suspend fun startRoute(routeId: String, version: Int) = refuse()
    override suspend fun completeDelivery(requestId: String, routeId: String, deliveryId: String,
        position: GpsPoint?, confirmFar: Boolean) = refuse()
    override suspend fun reportFailure(requestId: String, routeId: String, deliveryId: String, reason: FailureReason, notes: String) = refuse()
    override suspend fun arriveAtStore(routeId: String, position: GpsPoint?) = refuse()
    override suspend fun arriveForShift(position: GpsPoint?, auto: Boolean) = refuse()
    override suspend fun recordLocations(routeId: String, points: List<GpsPoint>) = refuse()
    override suspend fun notifyCustomers(routeId: String) = Unit
    override suspend fun settleRoute(routeId: String) = Unit
    override suspend fun inspectInvite(code: String): InviteCheck = refuse()
    override suspend fun requestMembership(code: String): InviteRequest = refuse()
    override suspend fun deleteAccount() = refuse()
    override suspend fun photo(): ByteArray? = refuse()
    override suspend fun savePhoto(jpeg: ByteArray) = refuse()
    override suspend fun removePhoto() = refuse()
}
