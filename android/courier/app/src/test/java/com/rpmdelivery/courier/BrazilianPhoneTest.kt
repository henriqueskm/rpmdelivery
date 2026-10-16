package com.rpmdelivery.courier

import com.rpmdelivery.courier.registration.BrazilianPhone
import org.junit.Assert.*
import org.junit.Test

class BrazilianPhoneTest {
    @Test fun nationalAndInternationalPastesNormalizeToTheSameDigits() {
        for (input in listOf("11987654321", "(11) 98765-4321", "+55 (11) 98765-4321", "  +55 11 98765.4321  ")) {
            assertEquals("11987654321", BrazilianPhone.parseInput(input)?.nationalDigits)
            assertEquals("+5511987654321", BrazilianPhone.toE164(input))
        }
    }

    @Test fun nationalDdd55IsNotMistakenForTheCountryCode() {
        assertEquals("55987654321", BrazilianPhone.parseInput("(55) 98765-4321")?.nationalDigits)
        assertEquals("+5555987654321", BrazilianPhone.toE164("55987654321"))
    }

    @Test fun ddd55CannotBeReinterpretedAsACountryCodeToBypassTheLimit() {
        assertNull(BrazilianPhone.parseInput("559999999999"))
        assertNull(BrazilianPhone.parseInput("5599999999999"))
        assertNull(BrazilianPhone.parseInput("5511987654321"))
        assertEquals("11987654321", BrazilianPhone.parseInput("+5511987654321")?.nationalDigits)
    }

    @Test fun optionalEmptyAndIncompletePhoneHaveDifferentValidity() {
        assertTrue(BrazilianPhone.isValidOptional(""))
        assertNull(BrazilianPhone.toE164(""))
        for (input in listOf("1", "119876", "1198765432", "119876543210", "1198765432x")) {
            assertFalse(input, BrazilianPhone.isValidOptional(input))
            assertNull(input, BrazilianPhone.toE164(input))
        }
    }

    @Test fun invalidDddOrNonMobileSubscriberIsRejected() {
        for (input in listOf("00987654321", "20987654321", "23987654321", "52987654321", "1191234567", "11887654321")) {
            assertFalse(input, BrazilianPhone.isValidOptional(input))
            assertNull(BrazilianPhone.toE164(input))
        }
        for (ddd in listOf("11", "24", "37", "55", "61", "69", "77", "89", "99")) {
            assertTrue(BrazilianPhone.isValidOptional(ddd + "987654321"))
        }
    }

    @Test fun oversizedForeignAndArbitraryPastesAreNotSilentlyTruncated() {
        for (input in listOf("119876543210", "+1 (202) 555-1234", "+55 11 9876543210", "telefone11987654321", "11+9987654321")) {
            assertNull(input, BrazilianPhone.parseInput(input))
        }
    }

    @Test fun progressiveMaskNeverStoresPunctuation() {
        assertEquals("", BrazilianPhone.format(""))
        assertEquals("(1", BrazilianPhone.format("1"))
        assertEquals("(11) ", BrazilianPhone.format("11"))
        assertEquals("(11) 98765", BrazilianPhone.format("1198765"))
        assertEquals("(11) 98765-4", BrazilianPhone.format("11987654"))
        assertEquals("(11) 98765-4321", BrazilianPhone.format("11987654321"))
    }
}
