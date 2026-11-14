package com.rpmdelivery.courier.work

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.rpmdelivery.courier.auth.AuthController
import com.rpmdelivery.courier.auth.FakeAuth
import com.rpmdelivery.courier.auth.completeProfile
import com.rpmdelivery.courier.captureEvidence
import com.rpmdelivery.courier.ui.CourierApp
import com.rpmdelivery.courier.ui.theme.CourierTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "pt-rBR-w320dp-h640dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class CompactWorkTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    @After fun cleanup() { scope.cancel() }

    @Test fun longStopAndLargeFontKeepEveryActionReachableAt320() {
        val fake = FakeWork()
        fake.home = fake.home.copy(shift = Shift("shift-1", "r-1", "Cozinha da Vila", "ON_ROUTE", null))
        fake.assign()
        fake.home = fake.home.copy(route = fake.home.route!!.let { route ->
            route.copy(status = "ON_ROUTE", pickupReleased = true, nextDeliveryId = "d-1", stops = route.stops.mapIndexed { index, stop ->
                if (index == 0) stop.copy(status = "NEXT", attempts = 1,
                    customerName = "Maria Aparecida dos Santos Albuquerque de Vasconcelos",
                    address = "Avenida Professor Doutor Francisco de Paula Vicente de Azevedo, 1234, bloco C",
                    notes = "Interfone quebrado; ligar para a portaria e pedir para chamar a moradora do 12º andar")
                else stop.copy(status = "ON_ROUTE")
            })
        })
        val controller = AuthController(FakeAuth().apply { current = completeProfile }, scope)
        val work = WorkController(fake, scope, onExpired = { }, refreshMillis = 3_600_000)
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(1f, 1.5f)) { CourierTheme { CourierApp(controller, work) } }
        }
        compose.runOnIdle { controller.restore() }
        compose.onAllNodesWithText("Maria Aparecida dos Santos Albuquerque de Vasconcelos").onFirst().performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Vila Mariana · Prazo", substring = true).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("2ª tentativa", substring = true).performScrollTo().assertIsDisplayed()
        captureEvidence(compose, "work-07-next-stop-320-font150")
        for (label in listOf("Abrir navegação", "Deslize para confirmar a entrega", "Não consegui entregar", "Ligar para a loja")) {
            compose.onNodeWithText(label).performScrollTo().assertIsDisplayed().assertHeightIsAtLeast(48.dp)
        }
        captureEvidence(compose, "work-08-actions-320-font150")
    }
}
