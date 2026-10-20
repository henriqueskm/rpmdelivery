package com.rpmdelivery.courier.auth

import java.net.URI
import java.net.URLDecoder

object ConfirmationLink {
    const val REDIRECT = "rpmdelivery://auth/confirm"
    /** Only authorization codes, never implicit tokens, external redirects or user supplied URLs. */
    fun code(value: String): String? = runCatching {
        require(value.length <= 2048)
        val uri = URI(value)
        require(uri.scheme == "rpmdelivery" && uri.rawAuthority == "auth" && uri.rawPath == "/confirm")
        require(uri.fragment == null)
        val pairs = uri.rawQuery.orEmpty().split('&').map { it.split('=', limit = 2) }
        require(pairs.size == 1 && pairs.single().size == 2 && pairs.single()[0] == "code")
        URLDecoder.decode(pairs.single()[1], "UTF-8").also {
            require(it.matches(Regex("[A-Za-z0-9_-]{8,512}")))
        }
    }.getOrNull()
}
