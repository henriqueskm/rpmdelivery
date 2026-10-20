package com.rpmdelivery.courier.auth

import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import javax.crypto.KeyGenerator

class SessionSecurityTest {
    @Test fun encryptedPayloadIsRandomizedAuthenticatedAndBoundToItsPurpose() {
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val secret = "synthetic-refresh-token"
        val first = SessionCipher.seal(key, "session", secret)
        val second = SessionCipher.seal(key, "session", secret)
        assertFalse(first.contentEquals(second))
        assertFalse(String(first, Charsets.ISO_8859_1).contains(secret))
        assertEquals(secret, SessionCipher.open(key, "session", first))
        assertTrue(runCatching { SessionCipher.open(key, "pkce", first) }.isFailure)
        first[first.lastIndex] = (first.last().toInt() xor 1).toByte()
        assertTrue(runCatching { SessionCipher.open(key, "session", first) }.isFailure)
    }
    @Test fun verifierExpiresAndIsRemovedAfterUse() = runTest {
        val store = MemorySecrets()
        var now = 1_000L
        val cache = ProtectedVerifierCache(store) { now }
        cache.saveCodeVerifier("synthetic-proof")
        assertEquals("synthetic-proof", cache.loadCodeVerifier())
        now += 86_400_001
        assertNull(cache.loadCodeVerifier())
        assertTrue(store.values.isEmpty())
        cache.saveCodeVerifier("second-proof"); cache.deleteCodeVerifier()
        assertNull(cache.loadCodeVerifier())
    }
    @Test fun onlyExactPkceCallbackIsAccepted() {
        assertEquals("code_123456", ConfirmationLink.code("rpmdelivery://auth/confirm?code=code_123456"))
        for (bad in listOf(
            "https://auth/confirm?code=code_123456", "rpmdelivery://evil/confirm?code=code_123456",
            "rpmdelivery://auth/confirm/extra?code=code_123456", "rpmdelivery://auth:443/confirm?code=code_123456",
            "rpmdelivery://auth/confirm?code=one&code=two", "rpmdelivery://auth/confirm?code=code_123456&next=https://evil.invalid",
            "rpmdelivery://auth/confirm#access_token=secret", "rpmdelivery://auth/confirm?code=%0A123456789",
            "rpmdelivery://user@auth/confirm?code=code_123456", "rpmdelivery://auth/confirm?token_hash=123456789",
        )) assertNull(bad.substringBefore('?'), ConfirmationLink.code(bad))
    }
    @Test fun legacyValidValuesRemainUnchangedAndMissingValuesCanBeCompleted() {
        val old = CourierRegistration(name = "Nome antigo", model = "Modelo legítimo fora do catálogo", plate = "ABC1D23")
        val repaired = old.mergedWith(completeProfile)
        assertEquals(old.name, repaired.name); assertEquals(old.model, repaired.model); assertEquals(old.plate, repaired.plate)
        assertEquals("Preta", repaired.color); assertTrue(repaired.complete)
        assertFalse(CourierRegistration(name = "Existe", model = " ").complete)
        assertFalse(completeProfile.copy(model = "x".repeat(81)).complete)
    }
}
