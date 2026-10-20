package com.rpmdelivery.courier.auth

internal class MemorySecrets : SecretStore {
    val values = mutableMapOf<String, String>()
    override suspend fun read(name: String) = values[name]
    override suspend fun write(name: String, value: String) { values[name] = value }
    override suspend fun remove(name: String) { values.remove(name) }
}

internal val completeProfile = CourierRegistration("Pessoa sintética", "+5511987654321", "Honda CG 160 Fan", "ABC1D23", "Preta")

internal open class FakeAuth : CourierAuthRepository {
    var current: CourierRegistration? = null
    var loginFailure: AuthProblem? = null
    var completionFailure: AuthProblem? = null
    var completions = 0
    var logins = 0
    override suspend fun restore() = current
    override suspend fun login(email: String, password: String): CourierRegistration {
        logins++
        loginFailure?.let { throw it }
        return current ?: completeProfile.also { current = it }
    }
    override suspend fun signup(name: String, email: String, password: String): CourierRegistration? = null
    override suspend fun confirm(callback: String) = CourierRegistration(name = "Pessoa sintética").also { current = it }
    override suspend fun profile() = current ?: throw AuthProblem(AuthCopy.EXPIRED)
    override suspend fun complete(input: CourierRegistration): CourierRegistration {
        completionFailure?.let { throw it }
        completions++; return (current ?: CourierRegistration()).mergedWith(input).also { current = it }
    }
    override suspend fun logout(): Boolean { current = null; return true }
    override suspend fun close() = Unit
}
