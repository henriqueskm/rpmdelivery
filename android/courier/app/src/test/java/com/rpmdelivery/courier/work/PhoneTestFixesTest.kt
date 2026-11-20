package com.rpmdelivery.courier.work

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import com.rpmdelivery.courier.shift.RouteBubble
import com.rpmdelivery.courier.ui.screens.mapQuery
import com.rpmdelivery.courier.ui.screens.stopSearch
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowSettings

/** Findings from the first real-phone test (2026-11-20). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PhoneTestFixesTest {
    private val app: Application get() = ApplicationProvider.getApplicationContext()
    @After fun reset() { RouteBubble.setRoute(app, false); RouteBubble.setAppVisible(app, true) }

    @Test fun mapsSearchesTheWrittenAddressNotOurApproximatePin() {
        val search = stopSearch("Rua Egito 112, Itatiba - São Paulo, 13256-716, Brasil", "Jardim das Nações")
        assertEquals("Rua Egito 112, Jardim das Nações, Itatiba - São Paulo, 13256-716, Brasil", search)
        val uri = mapQuery(-23.006955, -46.867447, search)
        assertTrue(uri, uri.startsWith("geo:0,0?q=Rua%20Egito%20112"))
        assertFalse("the coordinates stay out when there is an address", uri.contains("-23.006955"))
        // Coordinates only when there is nothing to search.
        assertEquals("geo:-23.5,-46.6?q=-23.5,-46.6", mapQuery(-23.5, -46.6, " "))
        // The bairro is not repeated, and a one-part address still gets it.
        assertEquals("Rua A 1, Centro, Itatiba", stopSearch("Rua A 1, Centro, Itatiba", "Centro"))
        assertEquals("Rua A 1, Centro", stopSearch("Rua A 1", "Centro"))
        assertEquals("Rua A 1, Itatiba", stopSearch("Rua A 1, Itatiba", null))
    }

    @Test fun bubbleShowsOnlyOnTheStreetOutsideTheAppWithPermission() {
        assertFalse(RouteBubble.shouldShow(routeActive = false, appVisible = false, allowed = true))
        assertFalse(RouteBubble.shouldShow(routeActive = true, appVisible = true, allowed = true))
        assertFalse(RouteBubble.shouldShow(routeActive = true, appVisible = false, allowed = false))
        assertTrue(RouteBubble.shouldShow(routeActive = true, appVisible = false, allowed = true))

        // Without the permission nothing is drawn over other apps.
        ShadowSettings.setCanDrawOverlays(false)
        RouteBubble.setRoute(app, true); RouteBubble.setAppVisible(app, false)
        assertFalse(RouteBubble.shown)

        ShadowSettings.setCanDrawOverlays(true)
        RouteBubble.setAppVisible(app, false)
        assertTrue(RouteBubble.shown)
        // Back in the app, or the route over: gone.
        RouteBubble.setAppVisible(app, true)
        assertFalse(RouteBubble.shown)
        RouteBubble.setAppVisible(app, false)
        assertTrue(RouteBubble.shown)
        RouteBubble.setRoute(app, false)
        assertFalse(RouteBubble.shown)
    }
}
