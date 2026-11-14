package com.rpmdelivery.courier.work

import com.rpmdelivery.courier.auth.MemorySecrets
import com.rpmdelivery.courier.auth.SupabaseCourierAuth
import com.rpmdelivery.courier.auth.courierClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException

/** Wire contract of the courier commands through MockEngine: no sockets, hosted users or privileged keys. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SupabaseCourierWorkTest {
    private val uid = "00000000-0000-4000-8000-000000000001"
    private val user = """{"id":"$uid","aud":"authenticated","email":"synthetic@example.invalid"}"""
    private val session = """{"access_token":"synthetic-access","refresh_token":"synthetic-refresh","expires_in":3600,"token_type":"bearer","user":$user}"""
    private val home = """{"serverNow":"2026-11-14T12:00:00+00:00","stores":[{"restaurantId":"r-1","name":"Cozinha","linkStatus":"ACTIVE"}],"shift":null,"route":null}"""
    private val requests = mutableListOf<HttpRequestData>()
    private val bodies = mutableMapOf<String, String>()
    /** Lets a test answer one RPC differently; returning null falls back to success. */
    private var override: ((String) -> Pair<String, HttpStatusCode>?)? = null
    private var offline = false

    private fun answer(request: HttpRequestData): Pair<String, HttpStatusCode> {
        requests += request
        if (offline && request.url.encodedPath.startsWith("/rest/v1/rpc/")) throw IOException("synthetic connection failure")
        val path = request.url.encodedPath
        return when {
            path == "/auth/v1/token" -> session to HttpStatusCode.OK
            path == "/auth/v1/user" -> user to HttpStatusCode.OK
            path == "/rest/v1/profiles" -> """[{"id":"$uid","name":"Pessoa","phone":"+5511987654321"}]""" to HttpStatusCode.OK
            path == "/rest/v1/couriers" -> """[{"id":"c-1","user_id":"$uid","motorcycle_model":"Moto","motorcycle_plate":"ABC1D23","motorcycle_color":"Preta"}]""" to HttpStatusCode.OK
            path.startsWith("/rest/v1/rpc/") -> {
                val name = path.removePrefix("/rest/v1/rpc/")
                bodies[name] = (request.body as TextContent).text
                override?.invoke(name) ?: ((if (name == "get_courier_home") home else "{}") to HttpStatusCode.OK)
            }
            else -> throw AssertionError("Unexpected mock request: $path")
        }
    }

    private fun repositories(): Pair<SupabaseCourierAuth, SupabaseCourierWork> {
        val gate = Mutex()
        val client = courierClient("https://auth-fixture.invalid", "sb_publishable_synthetic", MemorySecrets(), MockEngine { request ->
            val (text, status) = answer(request)
            respond(text, status, headersOf(HttpHeaders.ContentType, "application/json"))
        })
        return SupabaseCourierAuth(client, gate) to SupabaseCourierWork(client, gate, "https://auth-fixture.invalid", "sb_publishable_synthetic")
    }
    private fun body(name: String) = Json.parseToJsonElement(bodies.getValue(name)).jsonObject

    @Test fun commandsSendOnlyTheirOwnArguments() = runBlocking {
        val (auth, work) = repositories()
        try {
            auth.login("synthetic@example.invalid", "synthetic-pass")
            assertEquals("Cozinha", work.home().stores.single().name)
            assertEquals(emptySet<String>(), body("get_courier_home").keys)
            work.requestShift("r-1")
            assertEquals("r-1", body("request_shift")["p_restaurant_id"]!!.jsonPrimitive.content)
            work.startRoute("route-1", 3)
            assertEquals(setOf("p_route_id", "p_expected_version"), body("start_route").keys)
            assertEquals("3", body("start_route")["p_expected_version"]!!.jsonPrimitive.content)
            work.completeDelivery("req-1", "route-1", "d-1")
            assertEquals(setOf("p_request_id", "p_route_id", "p_delivery_id"), body("complete_delivery").keys)
            work.reportFailure("req-2", "route-1", "d-2", FailureReason.CUSTOMER_NOT_RESPONDING, "   ")
            assertEquals("CUSTOMER_NOT_RESPONDING", body("report_delivery_failure")["p_reason"]!!.jsonPrimitive.content)
            assertEquals("blank notes travel as null", JsonNull, body("report_delivery_failure")["p_notes"])
            work.arriveAtStore("route-1")
            work.endShift("shift-1")
            assertEquals(setOf("p_shift_id"), body("end_shift").keys)
            assertTrue("no request may carry a user or courier id",
                bodies.values.none { it.contains("user_id") || it.contains("courier_id") || it.contains(uid) })
            assertTrue(requests.filter { it.url.encodedPath.startsWith("/rest/v1/rpc/") }
                .all { it.headers[HttpHeaders.Authorization] == "Bearer synthetic-access" })
        } finally { auth.close() }
    }

    @Test fun locationsTravelInTheShapeTheServerChecks() = runBlocking {
        val (auth, work) = repositories()
        try {
            auth.login("synthetic@example.invalid", "synthetic-pass")
            work.recordLocations("route-1", listOf(
                GpsPoint(-23.55, -46.63, 8.5, "2026-11-14T12:00:00Z"),
                GpsPoint(-23.56, -46.64, null, "2026-11-14T12:00:05Z")))
            val sent = body("record_courier_locations")
            assertEquals(setOf("p_route_id", "p_points"), sent.keys)
            val points = sent["p_points"]!!.jsonArray
            assertEquals(2, points.size)
            assertEquals(setOf("latitude", "longitude", "accuracy", "recordedAt"), points[0].jsonObject.keys)
            assertEquals("8.5", points[0].jsonObject["accuracy"]!!.jsonPrimitive.content)
            assertEquals(JsonNull, points[1].jsonObject["accuracy"])
            assertTrue(runCatching { work.recordLocations("route-1", emptyList()) }.isFailure)
        } finally { auth.close() }
    }

    @Test fun storeRefusalBecomesItsSentence() = runBlocking {
        val (auth, work) = repositories()
        try {
            auth.login("synthetic@example.invalid", "synthetic-pass")
            override = { name -> if (name == "start_route")
                """{"code":"P0001","message":"RPM_ROUTE_STALE","details":null,"hint":null}""" to HttpStatusCode.BadRequest else null }
            val error = runCatching { work.startRoute("route-1", 2) }.exceptionOrNull() as WorkProblem
            assertEquals("RPM_ROUTE_STALE", error.code)
            assertEquals(WorkCopy.forCode("RPM_ROUTE_STALE"), error.safeMessage)
        } finally { auth.close() }
    }

    @Test fun expiredAccessTokenIsRenewedOnceAndTheReadRepeated() = runBlocking {
        val (auth, work) = repositories()
        try {
            auth.login("synthetic@example.invalid", "synthetic-pass")
            var rejected = false
            override = { name -> if (name == "get_courier_home" && !rejected) {
                rejected = true
                """{"code":"PGRST303","message":"JWT expired","details":null,"hint":null}""" to HttpStatusCode.Unauthorized
            } else null }
            requests.clear()
            assertEquals("Cozinha", work.home().stores.single().name)
            assertTrue(requests.any { it.url.parameters["grant_type"] == "refresh_token" })
            assertEquals(2, requests.count { it.url.encodedPath == "/rest/v1/rpc/get_courier_home" })
        } finally { auth.close() }
    }

    @Test fun lostConnectionIsReportedAsNetwork() = runBlocking {
        val (auth, work) = repositories()
        try {
            auth.login("synthetic@example.invalid", "synthetic-pass")
            offline = true
            val error = runCatching { work.home() }.exceptionOrNull() as WorkProblem
            assertTrue(error.network)
        } finally { auth.close() }
    }

    @Test fun withoutSessionNothingIsSent() = runBlocking {
        val (auth, work) = repositories()
        try {
            val error = runCatching { work.home() }.exceptionOrNull() as WorkProblem
            assertTrue(error.expired)
            assertTrue(requests.none { it.url.encodedPath.startsWith("/rest/v1/") })
        } finally { auth.close() }
    }
}
