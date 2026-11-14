package com.rpmdelivery.courier.shift

import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationCompat
import com.rpmdelivery.courier.work.CourierHome
import com.rpmdelivery.courier.work.CourierRoute
import com.rpmdelivery.courier.work.Shift
import com.rpmdelivery.courier.work.Store
import com.rpmdelivery.courier.work.StoreContact
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** The service in an unconfigured APK: it goes to the foreground and never touches location while waiting. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ShiftServiceTest {
    @Test fun startsInTheForegroundWithTheShiftLineAndStopsCleanly() {
        val controller = Robolectric.buildService(ShiftService::class.java).create().startCommand(0, 1)
        val service = controller.get()
        val notification = shadowOf(service).lastForegroundNotification
        assertNotNull("the shift line is shown at once", notification)
        assertEquals("Em turno", notification!!.extras.getString(NotificationCompat.EXTRA_TITLE))
        val manager = RuntimeEnvironment.getApplication().getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        assertNotNull(manager.getNotificationChannel("turno"))
        assertNotNull(manager.getNotificationChannel("avisos"))
        assertEquals(NotificationManager.IMPORTANCE_HIGH, manager.getNotificationChannel("avisos").importance)
        controller.destroy()
    }

    @Test fun ongoingLineFollowsTheShiftWithoutCustomerData() {
        val store = Store("r-1", "Cozinha da Vila", "ACTIVE")
        fun home(status: String, position: Int? = null, route: CourierRoute? = null) =
            CourierHome(listOf(store), Shift("s-1", "r-1", "Cozinha da Vila", status, position), route)
        fun route(status: String, released: Boolean = true) =
            CourierRoute("route-1", status, 1, null, released, StoreContact("Cozinha da Vila", null, null, null, null), emptyList())
        assertEquals("Aguardando a loja aprovar seu turno", ShiftNotifications.ongoingText(home("PENDING"), false))
        assertEquals("2º da fila", ShiftNotifications.ongoingText(home("AVAILABLE", 2), false))
        assertEquals("A loja está montando sua rota", ShiftNotifications.ongoingText(home("AVAILABLE", route = route("PREPARING", false)), false))
        assertEquals("Rota pronta para retirada", ShiftNotifications.ongoingText(home("AVAILABLE", route = route("PREPARING")), false))
        assertEquals("Rota em andamento · localização ativa", ShiftNotifications.ongoingText(home("ON_ROUTE", route = route("ON_ROUTE")), true))
        assertEquals("Voltando para a loja", ShiftNotifications.ongoingText(home("RETURNING", route = route("RETURNING")), false))
    }
}
