package com.rpmdelivery.courier.auth

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.FlowType
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.exception.AuthRestException
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.exceptions.RestException
import io.github.jan.supabase.logging.LogLevel
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.time.Duration.Companion.seconds

// The pinned SDK requires this opt-in to disable HTTP redirects. No custom logging is installed.
@OptIn(io.github.jan.supabase.annotations.SupabaseInternal::class)
fun courierClient(url: String, key: String, store: SecretStore, engine: HttpClientEngine? = null): SupabaseClient =
    createSupabaseClient(url, key) {
        httpEngine = engine ?: OkHttp.create { config { retryOnConnectionFailure(false) } }
        defaultLogLevel = LogLevel.NONE
        requestTimeout = 15.seconds
        httpConfig { followRedirects = false }
        install(Auth) {
            flowType = FlowType.PKCE
            defaultRedirectUrl = ConfirmationLink.REDIRECT
            autoLoadFromStorage = false
            alwaysAutoRefresh = false
            enableLifecycleCallbacks = false
            sessionManager = ProtectedSessionManager(store)
            codeVerifierCache = ProtectedVerifierCache(store)
        }
        install(Postgrest)
    }

/** All commands share a mutex; no blind HTTP retries and no background polling. */
class SupabaseCourierAuth(private val client: SupabaseClient) : CourierAuthRepository {
    private val mutex = Mutex()

    private suspend fun <T> command(block: suspend () -> T): T = mutex.withLock {
        try { client.auth.awaitInitialization(); block() }
        catch (error: CancellationException) { throw error }
        catch (error: AuthProblem) { throw error }
        catch (error: AuthRestException) {
            if (error.error in setOf("refresh_token_not_found", "refresh_token_already_used", "session_not_found", "bad_jwt") ||
                (error.statusCode == 401 && error.error !in setOf("invalid_credentials", "email_not_confirmed"))) {
                client.auth.clearSession()
                throw AuthProblem(AuthCopy.EXPIRED)
            }
            throw AuthProblem(when (error.error) {
                "email_not_confirmed" -> "Confirme seu e-mail antes de entrar. Abra a mensagem enviada para sua conta."
                "email_address_invalid", "validation_failed" -> "Confira o endereço de e-mail. Use um e-mail válido para receber a confirmação."
                "invalid_credentials" -> "E-mail ou senha incorretos. Confira e tente novamente."
                "user_already_exists", "email_exists" -> "Se você já possui uma conta, entre com seu e-mail e senha."
                "weak_password" -> "Escolha uma senha mais forte, com pelo menos 8 caracteres."
                "otp_expired", "flow_state_expired", "flow_state_not_found", "bad_code_verifier" -> AuthCopy.LINK
                "over_email_send_rate_limit", "over_request_rate_limit" -> "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente."
                else -> "Não foi possível concluir a autenticação. Tente novamente."
            })
        } catch (error: RestException) {
            if (error.statusCode == 401) {
                client.auth.clearSession()
                throw AuthProblem(AuthCopy.EXPIRED)
            }
            throw AuthProblem("Não foi possível carregar ou salvar o cadastro. Confira os campos e tente novamente.")
        } catch (_: java.io.IOException) { throw AuthProblem(AuthCopy.NETWORK) }
        catch (_: io.ktor.client.plugins.HttpRequestTimeoutException) { throw AuthProblem(AuthCopy.NETWORK) }
        catch (_: Exception) { throw AuthProblem("Não foi possível concluir esta ação com segurança. Tente novamente.") }
    }

    override suspend fun restore(): CourierRegistration? = command {
        val saved = try { client.auth.sessionManager.loadSessionOrNull() }
            catch (_: Exception) { throw AuthProblem(AuthCopy.STORAGE) }
        if (saved == null) return@command null
        // Always validate/rotate a restored refresh token with Auth, never trust serialized user metadata.
        val refreshed = client.auth.refreshSession(saved.refreshToken)
        client.auth.importSession(refreshed, autoRefresh = false)
        readProfile()
    }

    override suspend fun login(email: String, password: String): CourierRegistration = command {
        require(email.isNotBlank() && password.isNotEmpty())
        client.auth.signInWith(Email) { this.email = email.trim(); this.password = password }
        readProfile()
    }

    override suspend fun signup(name: String, email: String, password: String): CourierRegistration? = command {
        require(CourierRegistration().valid(name, 120) && email.isNotBlank() && password.length >= 8)
        check(client.auth.currentSessionOrNull() == null)
        client.auth.signUpWith(Email, redirectUrl = ConfirmationLink.REDIRECT) {
            this.email = email.trim(); this.password = password
            data = buildJsonObject { put("name", name.trim()) }
        }
        // A returned user can be obfuscated for an existing account. Only a verified session counts.
        if (client.auth.currentSessionOrNull() == null) null else readProfile()
    }

    override suspend fun confirm(callback: String): CourierRegistration = command {
        val code = ConfirmationLink.code(callback) ?: throw AuthProblem(AuthCopy.LINK)
        if (client.auth.currentSessionOrNull() != null || client.auth.codeVerifierCache.loadCodeVerifier() == null)
            throw AuthProblem(AuthCopy.LINK)
        client.auth.exchangeCodeForSession(code)
        readProfile()
    }

    override suspend fun profile(): CourierRegistration = command {
        requireSession()
        client.auth.refreshCurrentSession()
        readProfile()
    }

    override suspend fun complete(input: CourierRegistration): CourierRegistration = command {
        requireSession()
        client.auth.refreshCurrentSession()
        val existing = readProfile()
        val merged = existing.mergedWith(input)
        if (!merged.complete) throw AuthProblem("Complete os campos que faltam. Não escolha uma moto diferente da sua.")
        client.postgrest.rpc("complete_courier_registration", buildJsonObject {
            put("p_name", merged.name); put("p_phone", merged.phone)
            put("p_model", merged.model); put("p_plate", merged.plate); put("p_color", merged.color)
        })
        // Backend is authoritative, including preservation of valid legacy values and concurrent retries.
        readProfile().also { if (!it.complete) throw AuthProblem("O cadastro ainda está incompleto. Confira os campos e tente novamente.") }
    }

    private fun requireSession() {
        if (client.auth.currentSessionOrNull() == null) throw AuthProblem(AuthCopy.EXPIRED)
    }

    private suspend fun readProfile(): CourierRegistration {
        requireSession()
        val id = client.auth.retrieveUserForCurrentSession().id
        val profile = client.from("profiles").select(Columns.list("id", "name", "phone")) {
            filter { eq("id", id) }; limit(1)
        }.decodeList<JsonObject>().singleOrNull() ?: throw AuthProblem("Seu perfil ainda não está disponível. Tente atualizar o cadastro.")
        // Column grants intentionally reject SELECT * and GPS fields. Always use this explicit list.
        val courier = client.from("couriers").select(Columns.list("id", "user_id", "motorcycle_model", "motorcycle_plate", "motorcycle_color")) {
            filter { eq("user_id", id) }; limit(1)
        }.decodeList<JsonObject>().singleOrNull()
        fun JsonObject?.text(key: String) = this?.get(key)?.jsonPrimitive?.contentOrNull.orEmpty()
        check(profile.text("id") == id && (courier == null || courier.text("user_id") == id))
        return CourierRegistration(profile.text("name"), profile.text("phone"), courier.text("motorcycle_model"),
            courier.text("motorcycle_plate"), courier.text("motorcycle_color"))
    }

    override suspend fun logout(): Boolean = command {
        var revoked = client.auth.currentSessionOrNull() != null
        try { if (revoked) client.auth.signOut() }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { revoked = false }
        finally { client.auth.clearSession() }
        revoked
    }

    override suspend fun close() { client.close() }
}
