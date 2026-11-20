package com.rpmdelivery.courier.work

import java.net.URI

/**
 * A store's courier invite. The panel shows it as `https://rpmdelivery.vercel.app/convite#c=<code>`
 * (QR Code or copied link); the code is a secret of 20 hex characters, kept in memory only and never
 * logged, saved or rendered.
 */
object InviteLink {
    const val HOST = "rpmdelivery.vercel.app"
    private val CODE = Regex("[a-f0-9]{20}")

    /** Same rule as the site: 20 hex characters, with or without hyphens and spaces, any case. */
    fun normalize(value: String): String? =
        value.trim().replace(Regex("[-\\s]"), "").lowercase().takeIf { it.matches(CODE) }

    /** The code of an invite link from this site only; anything else (other hosts, queries, ports) is ignored. */
    fun code(value: String): String? = runCatching {
        require(value.length <= 512)
        val uri = URI(value)
        require(uri.scheme == "https" && uri.rawAuthority == HOST && uri.rawPath == "/convite" && uri.rawQuery == null)
        val pairs = uri.rawFragment.orEmpty().split('&').map { it.split('=', limit = 2) }
        require(pairs.size == 1 && pairs.single().size == 2 && pairs.single()[0] == "c")
        normalize(pairs.single()[1])
    }.getOrNull()

    /** What a scanned QR Code holds: the invite link, or the bare code typed under it. */
    fun fromScan(value: String): String? = code(value.trim()) ?: normalize(value)
}

/** The server's answer to an invite. [registered]: the courier's profile is enough to ask for the link. */
data class InviteCheck(val ok: Boolean, val reason: String? = null, val restaurantName: String? = null, val registered: Boolean = false)
data class InviteRequest(val ok: Boolean, val reason: String? = null, val status: String? = null)

enum class InvitePhase { Waiting, Checking, Ready, Sending, Failed }

/**
 * The invite the courier is looking at. The code itself stays out of the state.
 * [retry]: the failure was the connection or the profile, so checking again may work.
 */
data class InviteCard(
    val phase: InvitePhase,
    val restaurantName: String? = null,
    val message: String? = null,
    val retry: Boolean = false,
)

object InviteCopy {
    fun refusal(reason: String?): String = when (reason) {
        "rate_limited" -> "Muitas tentativas. Aguarde 15 minutos antes de tentar novamente."
        "profile_required" -> "Complete seu cadastro de motoboy antes de pedir o vínculo."
        else -> "Convite indisponível. Confira o código ou peça um novo convite à loja."
    }
    fun requested(name: String, status: String?): String = when (status) {
        "ACTIVE" -> "Você já está vinculado a $name."
        "REJECTED" -> "A loja $name recusou o vínculo. Fale com a loja."
        "SUSPENDED" -> "Seu vínculo com $name está suspenso. Fale com a loja."
        else -> "Pedido enviado para $name. Quando a loja aprovar, ela aparece aqui."
    }
}
