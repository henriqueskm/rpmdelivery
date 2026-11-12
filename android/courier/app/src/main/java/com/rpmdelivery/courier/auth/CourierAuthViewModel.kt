package com.rpmdelivery.courier.auth

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.rpmdelivery.courier.BuildConfig
import kotlinx.coroutines.runBlocking

class CourierAuthViewModel(application: Application) : AndroidViewModel(application) {
    private val configured = BuildConfig.SUPABASE_URL.isNotBlank() && BuildConfig.SUPABASE_PUBLISHABLE_KEY.isNotBlank()
    private val repository: CourierAuthRepository = if (configured)
        SupabaseCourierAuth(courierClient(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_PUBLISHABLE_KEY, ProtectedStorage(application)))
        else UnconfiguredAuth()
    val controller = AuthController(repository, viewModelScope).also { it.restore() }
    override fun onCleared() { runBlocking { repository.close() } }
}

/** Unconfigured APKs cannot accidentally connect to any hosted project. */
private class UnconfiguredAuth : CourierAuthRepository {
    override suspend fun restore(): CourierRegistration? = null
    override suspend fun login(email: String, password: String): CourierRegistration = throw AuthProblem(AuthCopy.CONFIG)
    override suspend fun signup(name: String, email: String, password: String): CourierRegistration? = throw AuthProblem(AuthCopy.CONFIG)
    override suspend fun confirm(callback: String): CourierRegistration = throw AuthProblem(AuthCopy.CONFIG)
    override suspend fun profile(): CourierRegistration = throw AuthProblem(AuthCopy.CONFIG)
    override suspend fun complete(input: CourierRegistration): CourierRegistration = throw AuthProblem(AuthCopy.CONFIG)
    override suspend fun logout() = true
    override suspend fun close() = Unit
}
