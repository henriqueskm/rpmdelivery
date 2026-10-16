package com.rpmdelivery.courier.demo

/** Local feedback for a visual prototype. Never authentication/authorization. */
object DemoFormValidation {
    fun isEmail(value: String): Boolean =
        value.length <= 254 && Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").matches(value.trim())

    fun isPassword(value: String): Boolean = value.length >= 8

    fun isRequiredText(value: String): Boolean = value.isNotBlank()
}
