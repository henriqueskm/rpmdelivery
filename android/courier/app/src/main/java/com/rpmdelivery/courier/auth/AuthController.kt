package com.rpmdelivery.courier.auth

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

enum class AuthScreen { Loading, Welcome, Login, Account, ConfirmEmail, Profile, Home, Preview, Recovery }
data class AuthState(
    val screen: AuthScreen = AuthScreen.Loading,
    val busy: Boolean = false,
    val message: String? = null,
    val registration: CourierRegistration = CourierRegistration(),
    val authenticated: Boolean = false,
)

/** No passwords, tokens or callback URLs in UI state, saved state, logs or analytics. */
class AuthController(private val repository: CourierAuthRepository, private val scope: CoroutineScope) {
    private val mutable = MutableStateFlow(AuthState())
    val state = mutable.asStateFlow()

    fun restore() = action {
        val profile = repository.restore()
        if (profile == null) mutable.value = AuthState(AuthScreen.Welcome)
        else signedIn(profile)
    }
    fun navigate(screen: AuthScreen) {
        if (mutable.value.busy) return
        val allowed = if (mutable.value.authenticated) setOf(AuthScreen.Home, AuthScreen.Profile, AuthScreen.Preview)
            else setOf(AuthScreen.Welcome, AuthScreen.Login, AuthScreen.Account, AuthScreen.Preview)
        if (screen in allowed) mutable.value = mutable.value.copy(screen = screen, message = null)
    }
    fun login(email: String, password: String) = action { signedIn(repository.login(email, password)) }
    fun signup(name: String, email: String, password: String) = action {
        val result = repository.signup(name, email, password)
        if (result == null) mutable.value = AuthState(AuthScreen.ConfirmEmail)
        else signedIn(result)
    }
    fun confirm(link: String) = scope.launch {
        state.first { !it.busy }
        action { signedIn(repository.confirm(link)) }
    }
    fun complete(input: CourierRegistration) = action {
        check(mutable.value.authenticated)
        signedIn(repository.complete(input))
    }
    fun reload() = action { signedIn(repository.profile()) }
    fun logout() = action {
        val revoked = repository.logout()
        mutable.value = AuthState(AuthScreen.Welcome, message = if (revoked) null else
            "Sessão removida deste aparelho. Sem conexão, não foi possível confirmar a revogação no servidor.")
    }
    private fun signedIn(profile: CourierRegistration) {
        mutable.value = AuthState(if (profile.complete) AuthScreen.Home else AuthScreen.Profile,
            registration = profile, authenticated = true)
    }
    private fun action(block: suspend () -> Unit) {
        if (mutable.value.busy) return
        mutable.value = mutable.value.copy(busy = true, message = null)
        scope.launch {
            try { block() }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) {
                val message = (error as? AuthProblem)?.safeMessage ?: "Não foi possível concluir esta ação. Tente novamente."
                mutable.value = if (message == AuthCopy.EXPIRED) AuthState(AuthScreen.Login, message = message)
                    else mutable.value.copy(screen = if (mutable.value.screen == AuthScreen.Loading) AuthScreen.Recovery else mutable.value.screen,
                        message = message)
            } finally { mutable.value = mutable.value.copy(busy = false) }
        }
    }
}
