package com.rpmdelivery.courier.auth

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AuthControllerTest {
    @Test fun signupWithoutSessionRequiresConfirmationAndNeverShowsDemoAsRealRoute() = runTest {
        val repository = FakeAuth(); val controller = AuthController(repository, this)
        controller.restore(); advanceUntilIdle()
        controller.navigate(AuthScreen.Account); controller.signup("Pessoa", "synthetic@example.invalid", "synthetic-pass")
        advanceUntilIdle()
        assertEquals(AuthScreen.ConfirmEmail, controller.state.value.screen)
        assertFalse(controller.state.value.authenticated)
        controller.navigate(AuthScreen.Home)
        assertEquals(AuthScreen.ConfirmEmail, controller.state.value.screen)
        controller.navigate(AuthScreen.Login); controller.login("synthetic@example.invalid", "synthetic-pass"); advanceUntilIdle()
        assertEquals(AuthScreen.Home, controller.state.value.screen)
        assertTrue(controller.state.value.authenticated)
    }
    @Test fun authenticatedLegacyIncompleteProfileIsRepairedBeforeHome() = runTest {
        val repository = FakeAuth().apply { current = CourierRegistration(name = "Nome salvo", model = "Modelo legado") }
        val controller = AuthController(repository, this)
        controller.restore(); advanceUntilIdle()
        assertEquals(AuthScreen.Profile, controller.state.value.screen)
        controller.complete(completeProfile); advanceUntilIdle()
        assertEquals(AuthScreen.Home, controller.state.value.screen)
        assertEquals("Nome salvo", controller.state.value.registration.name)
        assertEquals("Modelo legado", controller.state.value.registration.model)
        controller.logout(); advanceUntilIdle()
        assertFalse(controller.state.value.authenticated)
        assertEquals(CourierRegistration(), controller.state.value.registration)
    }
    @Test fun doubleClickDoesNotQueueDuplicateLogin() = runTest {
        val gate = CompletableDeferred<Unit>()
        val repository = object : FakeAuth() {
            override suspend fun login(email: String, password: String): CourierRegistration {
                logins++; gate.await(); return completeProfile
            }
        }
        val controller = AuthController(repository, this)
        controller.login("synthetic@example.invalid", "synthetic-pass")
        controller.login("synthetic@example.invalid", "synthetic-pass")
        advanceUntilIdle(); assertTrue(controller.state.value.busy); assertEquals(1, repository.logins)
        gate.complete(Unit); advanceUntilIdle(); assertEquals(AuthScreen.Home, controller.state.value.screen)
    }
    @Test fun expiredSessionClearsAuthenticatedUiAndNetworkFailureOffersRetry() = runTest {
        val repository = object : FakeAuth() {
            override suspend fun restore(): CourierRegistration = throw AuthProblem(AuthCopy.NETWORK)
        }
        val controller = AuthController(repository, this)
        controller.restore(); advanceUntilIdle()
        assertEquals(AuthScreen.Recovery, controller.state.value.screen)
        controller.navigate(AuthScreen.Login)
        repository.loginFailure = AuthProblem(AuthCopy.EXPIRED)
        controller.login("synthetic@example.invalid", "synthetic-pass"); advanceUntilIdle()
        assertEquals(AuthScreen.Login, controller.state.value.screen); assertFalse(controller.state.value.authenticated)
        assertEquals(AuthCopy.EXPIRED, controller.state.value.message)
    }
    @Test fun callbackArrivingDuringStartupWaitsForRestoration() = runTest {
        val gate = CompletableDeferred<Unit>()
        val repository = object : FakeAuth() {
            override suspend fun restore(): CourierRegistration? { gate.await(); return null }
        }
        val controller = AuthController(repository, this)
        controller.restore(); controller.confirm("${ConfirmationLink.REDIRECT}?code=code_123456")
        advanceUntilIdle(); assertEquals(AuthScreen.Loading, controller.state.value.screen)
        gate.complete(Unit); advanceUntilIdle()
        assertEquals(AuthScreen.Profile, controller.state.value.screen); assertTrue(controller.state.value.authenticated)
    }
    @Test fun anonymousUserCannotCompleteProfileOrNavigateToAuthenticatedScreen() = runTest {
        val repository = FakeAuth(); val controller = AuthController(repository, this)
        controller.restore(); advanceUntilIdle()
        controller.navigate(AuthScreen.Profile); assertEquals(AuthScreen.Welcome, controller.state.value.screen)
        controller.complete(completeProfile); advanceUntilIdle(); assertEquals(0, repository.completions)
        assertFalse(controller.state.value.authenticated)
    }
}
