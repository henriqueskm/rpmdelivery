package com.rpmdelivery.courier

import android.content.Context
import com.rpmdelivery.courier.auth.AuthCopy
import com.rpmdelivery.courier.auth.AuthProblem
import com.rpmdelivery.courier.auth.CourierAuthRepository
import com.rpmdelivery.courier.auth.CourierRegistration
import com.rpmdelivery.courier.auth.ProtectedStorage
import com.rpmdelivery.courier.auth.SupabaseCourierAuth
import com.rpmdelivery.courier.auth.courierClient
import com.rpmdelivery.courier.work.CourierWorkRepository
import com.rpmdelivery.courier.work.SupabaseCourierWork
import com.rpmdelivery.courier.work.UnconfiguredWork
import kotlinx.coroutines.sync.Mutex

/**
 * One Supabase client and session per process, shared by the screens and the shift service:
 * the service keeps running with the screen off and must use the same signed-in session.
 */
class CourierGraph private constructor(context: Context) {
    private val configured = BuildConfig.SUPABASE_URL.isNotBlank() && BuildConfig.SUPABASE_PUBLISHABLE_KEY.isNotBlank()
    private val client = if (configured)
        courierClient(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_PUBLISHABLE_KEY, ProtectedStorage(context)) else null
    // One session, one gate: sign-in, screens and service never refresh the session at the same time.
    private val gate = Mutex()
    val auth: CourierAuthRepository = client?.let { SupabaseCourierAuth(it, gate) } ?: UnconfiguredAuth()
    val work: CourierWorkRepository = client?.let {
        SupabaseCourierWork(it, gate, BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_PUBLISHABLE_KEY)
    } ?: UnconfiguredWork()

    companion object {
        @Volatile private var instance: CourierGraph? = null
        fun get(context: Context): CourierGraph = instance ?: synchronized(this) {
            instance ?: CourierGraph(context.applicationContext).also { instance = it }
        }
    }
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
