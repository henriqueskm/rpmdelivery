package com.rpmdelivery.courier.auth

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.rpmdelivery.courier.BuildConfig
import com.rpmdelivery.courier.work.CourierWorkRepository
import com.rpmdelivery.courier.work.SupabaseCourierWork
import com.rpmdelivery.courier.work.UnconfiguredWork
import com.rpmdelivery.courier.work.WorkController
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex

class CourierAuthViewModel(application: Application) : AndroidViewModel(application) {
    private val configured = BuildConfig.SUPABASE_URL.isNotBlank() && BuildConfig.SUPABASE_PUBLISHABLE_KEY.isNotBlank()
    private val client = if (configured)
        courierClient(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_PUBLISHABLE_KEY, ProtectedStorage(application)) else null
    // One session, one gate: sign-in and route commands never refresh the session at the same time.
    private val gate = Mutex()
    private val repository: CourierAuthRepository = client?.let { SupabaseCourierAuth(it, gate) } ?: UnconfiguredAuth()
    private val workRepository: CourierWorkRepository = client?.let {
        SupabaseCourierWork(it, gate, BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_PUBLISHABLE_KEY)
    } ?: UnconfiguredWork()
    val controller = AuthController(repository, viewModelScope).also { it.restore() }
    val work = WorkController(workRepository, viewModelScope, onExpired = { controller.sessionExpired() })
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
