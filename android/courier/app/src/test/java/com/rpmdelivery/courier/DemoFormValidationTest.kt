package com.rpmdelivery.courier

import com.rpmdelivery.courier.demo.DemoFormValidation
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DemoFormValidationTest {
    @Test fun emailFeedbackRejectsEmptyMalformedAndOversizedValues() {
        listOf("", " ", "sem-arroba", "nome@", "a b@example.invalid", "a".repeat(255) + "@x.invalid")
            .forEach { assertFalse(it, DemoFormValidation.isEmail(it)) }
        assertTrue(DemoFormValidation.isEmail(" motoboy@example.invalid "))
    }

    @Test fun demoPasswordAndMandatoryFieldsHaveLocalFeedback() {
        assertFalse(DemoFormValidation.isPassword("1234567"))
        assertTrue(DemoFormValidation.isPassword("ficticia123"))
        assertFalse(DemoFormValidation.isRequiredText(" \n\t"))
        assertTrue(DemoFormValidation.isRequiredText("Moto de teste"))
    }
}
