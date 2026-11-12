package com.rpmdelivery.courier.auth

data class CourierRegistration(
    val name: String = "", val phone: String = "", val model: String = "",
    val plate: String = "", val color: String = "",
) {
    val complete: Boolean get() = valid(name, 120) && valid(model, 80) && valid(plate, 20) && valid(color, 40)
    val hasStoredPhone: Boolean get() = phone.matches(Regex("[+]55[1-9][0-9]9[0-9]{8}"))
    fun valid(value: String, limit: Int): Boolean {
        val cleaned = value.trim()
        return cleaned.isNotEmpty() && cleaned.codePointCount(0, cleaned.length) <= limit
    }
    fun mergedWith(input: CourierRegistration) = CourierRegistration(
        if (valid(name, 120)) name else input.name.trim(),
        if (hasStoredPhone) phone else input.phone,
        if (valid(model, 80)) model else input.model.trim(),
        if (valid(plate, 20)) plate else input.plate.trim().uppercase(java.util.Locale.ROOT),
        if (valid(color, 40)) color else input.color.trim(),
    )
}

interface CourierAuthRepository {
    suspend fun restore(): CourierRegistration?
    suspend fun login(email: String, password: String): CourierRegistration
    /** null means email confirmation is pending; never infer authentication from a signup user. */
    suspend fun signup(name: String, email: String, password: String): CourierRegistration?
    suspend fun confirm(callback: String): CourierRegistration
    suspend fun profile(): CourierRegistration
    suspend fun complete(input: CourierRegistration): CourierRegistration
    suspend fun logout(): Boolean
    suspend fun close()
}

class AuthProblem(val safeMessage: String) : Exception()

object AuthCopy {
    const val NETWORK = "Não foi possível conectar. Confira sua internet e tente novamente."
    const val EXPIRED = "Sua sessão expirou. Entre novamente para continuar."
    const val CONFIRM = "Confira seu e-mail para confirmar sua conta"
    const val LINK = "Este link não pode ser usado aqui. Confirme no e-mail e entre com sua senha."
    const val STORAGE = "Não foi possível acessar a sessão protegida neste aparelho. Tente novamente ou saia para limpar a sessão local."
    const val CONFIG = "A conexão ainda não foi configurada neste APK. A prévia de Minha rota continua disponível separadamente."
}
