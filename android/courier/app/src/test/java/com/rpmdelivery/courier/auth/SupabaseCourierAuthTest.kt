package com.rpmdelivery.courier.auth

import io.github.jan.supabase.auth.auth
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.http.content.TextContent
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException

/** SDK and wire contracts through MockEngine: no sockets, hosted users or privileged keys. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SupabaseCourierAuthTest {
    private val uid = "00000000-0000-4000-8000-000000000001"
    private val user get() = """{"id":"$uid","aud":"authenticated","email":"synthetic@example.invalid"}"""
    private val session get() = """{"access_token":"synthetic-access","refresh_token":"synthetic-refresh","expires_in":3600,"token_type":"bearer","user":$user}"""
    private var incomplete = true
    private var rpcBody: String? = null
    private val requests = mutableListOf<HttpRequestData>()
    private val store = MemorySecrets()

    private fun body(request: HttpRequestData) = (request.body as TextContent).text
    private fun normal(request: HttpRequestData): String {
        requests += request
        assertEquals("auth-fixture.invalid", request.url.host)
        return when (request.url.encodedPath) {
            "/auth/v1/token" -> session
            "/auth/v1/user" -> user
            "/auth/v1/signup" -> user
            "/auth/v1/logout" -> "{}"
            "/rest/v1/profiles" -> {
                assertEquals("eq.$uid", request.url.parameters["id"])
                assertEquals("id,name,phone", request.url.parameters["select"])
                """[{"id":"$uid","name":"Nome salvo","phone":"+5511987654321"}]"""
            }
            "/rest/v1/couriers" -> {
                assertEquals("eq.$uid", request.url.parameters["user_id"])
                assertEquals("id,user_id,motorcycle_model,motorcycle_plate,motorcycle_color", request.url.parameters["select"])
                """[{"id":"00000000-0000-4000-8000-000000000002","user_id":"$uid","motorcycle_model":"Modelo legado fora do catálogo","motorcycle_plate":"ABC1D23","motorcycle_color":${if (incomplete) "null" else "\"Preta\""}}]"""
            }
            "/rest/v1/rpc/complete_courier_registration" -> {
                rpcBody = body(request); incomplete = false
                "\"00000000-0000-4000-8000-000000000002\""
            }
            else -> throw AssertionError("Unexpected mock request: ${request.url.encodedPath}")
        }
    }
    private fun client(handler: ((HttpRequestData) -> Pair<String, HttpStatusCode>)? = null) =
        courierClient("https://auth-fixture.invalid", "sb_publishable_synthetic", store, MockEngine { request ->
            val (text, status) = handler?.invoke(request) ?: (normal(request) to HttpStatusCode.OK)
            respond(text, status, headersOf(HttpHeaders.ContentType, "application/json"))
        })

    @Test fun pendingSignupAndRepeatedSignupNeverExecuteProfileRpc() = runBlocking {
        val sdk = client(); val repo = SupabaseCourierAuth(sdk)
        try {
            repeat(2) { assertNull(repo.signup("Pessoa", "synthetic@example.invalid", "synthetic-pass")) }
            assertNull(sdk.auth.currentSessionOrNull())
            assertEquals(2, requests.size)
            assertTrue(requests.all { it.url.encodedPath == "/auth/v1/signup" })
            val payload = Json.parseToJsonElement(body(requests.first())).jsonObject
            assertTrue(payload.containsKey("code_challenge"))
            assertFalse(payload.containsKey("user_id"))
            assertEquals(ConfirmationLink.REDIRECT, requests.first().url.parameters["redirect_to"])
            assertNotNull(store.values["pkce"])
            assertNull(store.values["session"])
        } finally { repo.close() }
    }
    @Test fun loginRepairsLegacyMissingColorAndPreservesIdentityAndStoredFieldsOnRetries() = runBlocking {
        val repo = SupabaseCourierAuth(client())
        try {
            assertFalse(repo.login("synthetic@example.invalid", "synthetic-pass").complete)
            repeat(2) { assertTrue(repo.complete(completeProfile.copy(name = "Outro", model = "Outra moto", plate = "OUT0000")).complete) }
            val payload = Json.parseToJsonElement(rpcBody!!).jsonObject
            assertEquals(setOf("p_name", "p_phone", "p_model", "p_plate", "p_color"), payload.keys)
            assertEquals("Nome salvo", payload["p_name"]!!.jsonPrimitive.content)
            assertEquals("Modelo legado fora do catálogo", payload["p_model"]!!.jsonPrimitive.content)
            assertEquals("ABC1D23", payload["p_plate"]!!.jsonPrimitive.content)
            assertEquals("Preta", payload["p_color"]!!.jsonPrimitive.content)
            assertNotNull(store.values["session"])
            assertFalse(store.values.values.any { it.contains("synthetic-pass") })
        } finally { repo.close() }
    }
    @Test fun missingRequiredFieldIsRejectedBeforeRpc() = runBlocking {
        val repo = SupabaseCourierAuth(client())
        try {
            repo.login("synthetic@example.invalid", "synthetic-pass")
            assertTrue(runCatching { repo.complete(CourierRegistration()) }.exceptionOrNull() is AuthProblem)
            assertNull(rpcBody)
        } finally { repo.close() }
    }
    @Test fun freshRepositoryRestoresAndValidatesSessionThenLogoutDeletesBothSecrets() = runBlocking {
        val first = SupabaseCourierAuth(client())
        first.login("synthetic@example.invalid", "synthetic-pass"); first.close()
        val second = SupabaseCourierAuth(client())
        try {
            assertNotNull(second.restore())
            assertTrue(requests.any { it.url.parameters["grant_type"] == "refresh_token" })
            assertTrue(second.logout()); assertTrue(store.values.isEmpty()); assertNull(second.restore())
        } finally { second.close() }
    }
    @Test fun invalidRefreshTokenClearsSessionAndDoesNotReadProfiles() = runBlocking {
        val first = SupabaseCourierAuth(client())
        first.login("synthetic@example.invalid", "synthetic-pass"); first.close(); requests.clear()
        val second = SupabaseCourierAuth(client { request ->
            requests += request
            """{"code":400,"error_code":"refresh_token_not_found","msg":"do not expose server detail"}""" to HttpStatusCode.BadRequest
        })
        try {
            val error = runCatching { second.restore() }.exceptionOrNull() as AuthProblem
            assertEquals(AuthCopy.EXPIRED, error.safeMessage)
            assertNull(store.values["session"]); assertEquals(1, requests.size)
        } finally { second.close() }
    }
    @Test fun networkFailureRetainsProtectedSessionForRetryAndOfflineLogoutStillClearsIt() = runBlocking {
        val first = SupabaseCourierAuth(client())
        first.login("synthetic@example.invalid", "synthetic-pass"); first.close()
        val offline = SupabaseCourierAuth(client { throw IOException("synthetic connection failure") })
        try {
            assertEquals(AuthCopy.NETWORK, (runCatching { offline.restore() }.exceptionOrNull() as AuthProblem).safeMessage)
            assertNotNull(store.values["session"])
            // A failed restore has not imported a session. Local deletion still succeeds.
            offline.logout(); assertTrue(store.values.isEmpty())
        } finally { offline.close() }
    }
    @Test fun confirmationRequiresPendingPkceAndDoesNotReplay() = runBlocking {
        val repo = SupabaseCourierAuth(client())
        try {
            assertEquals(AuthCopy.LINK, (runCatching { repo.confirm("${ConfirmationLink.REDIRECT}?code=code_123456") }.exceptionOrNull() as AuthProblem).safeMessage)
            assertTrue(requests.isEmpty())
            repo.signup("Pessoa", "synthetic@example.invalid", "synthetic-pass")
            assertFalse(repo.confirm("${ConfirmationLink.REDIRECT}?code=code_123456").complete)
            val exchange = requests.single { it.url.parameters["grant_type"] == "pkce" }
            assertTrue(Json.parseToJsonElement(body(exchange)).jsonObject.containsKey("code_verifier"))
            assertNull(store.values["pkce"])
            val size = requests.size
            assertTrue(runCatching { repo.confirm("${ConfirmationLink.REDIRECT}?code=code_123456") }.isFailure)
            assertEquals(size, requests.size)
        } finally { repo.close() }
    }
    @Test fun confirmationAfterReopeningPreservesVerifierWithoutCreatingSessionPrematurely() = runBlocking {
        val first = SupabaseCourierAuth(client())
        first.signup("Pessoa", "synthetic@example.invalid", "synthetic-pass"); first.close()
        val second = SupabaseCourierAuth(client())
        try {
            assertNull(second.restore())
            assertNotNull(store.values["pkce"])
            assertNull(store.values["session"])
            assertFalse(second.confirm("${ConfirmationLink.REDIRECT}?code=code_123456").complete)
            assertNotNull(store.values["session"])
            assertNull(store.values["pkce"])
        } finally { second.close() }
    }
    @Test fun unconfirmedInvalidEmailAndInvalidCredentialsHaveSafeDistinctMessages() = runBlocking {
        for ((code, expected) in listOf("email_not_confirmed" to "Confirme seu e-mail", "email_address_invalid" to "Confira o endereço", "invalid_credentials" to "E-mail ou senha")) {
            val repo = SupabaseCourierAuth(client { """{"code":400,"error_code":"$code","msg":"internal detail"}""" to HttpStatusCode.BadRequest })
            try {
                val message = (runCatching { repo.login("synthetic@example.invalid", "synthetic-pass") }.exceptionOrNull() as AuthProblem).safeMessage
                assertTrue(message.startsWith(expected)); assertFalse(message.contains("internal detail"))
            } finally { repo.close() }
        }
    }
    @Test fun corruptStoredSessionFailsClosedInsteadOfPretendingThereIsNoSession() = runBlocking {
        store.values["session"] = "corrupt"
        val repo = SupabaseCourierAuth(client())
        try {
            assertEquals(AuthCopy.STORAGE, (runCatching { repo.restore() }.exceptionOrNull() as AuthProblem).safeMessage)
            assertTrue(requests.isEmpty())
        } finally { repo.close() }
    }
    @Test fun httpRedirectDoesNotForwardCredentialsOrFollowExternalUrl() = runBlocking {
        val requests = mutableListOf<HttpRequestData>()
        val sdk = courierClient("https://auth-fixture.invalid", "sb_publishable_synthetic", store, MockEngine { request ->
            requests += request
            respond("", HttpStatusCode.Found, headersOf(HttpHeaders.Location, "https://external.invalid/leak"))
        })
        val repo = SupabaseCourierAuth(sdk)
        try {
            assertTrue(runCatching { repo.login("synthetic@example.invalid", "synthetic-pass") }.isFailure)
            assertEquals(1, requests.size); assertEquals("auth-fixture.invalid", requests.single().url.host)
        } finally { repo.close() }
    }
    @Test
    @Config(sdk = [26])
    fun sdkAuthenticationAlsoRunsOnMinimumAndroidUsingMockTransport() = runBlocking {
        val repo = SupabaseCourierAuth(client())
        try { assertEquals("Nome salvo", repo.login("synthetic@example.invalid", "synthetic-pass").name) }
        finally { repo.close() }
    }
}
