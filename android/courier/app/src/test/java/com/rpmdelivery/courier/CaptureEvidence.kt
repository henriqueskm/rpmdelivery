package com.rpmdelivery.courier

import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import java.io.File

fun captureEvidence(compose: ComposeContentTestRule, name: String) {
    // Compose 1.10 captureToImage waits for a real RenderThread frame callback,
    // unavailable in Robolectric. Use its supported PixelCopy window renderer.
    // https://github.com/robolectric/robolectric/issues/8071
    val bitmap = compose.runOnIdle {
        val window = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).single().window
        val view = window.decorView
        val image = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        var copied = false
        PixelCopy.request(window, image, { check(it == PixelCopy.SUCCESS); copied = true }, Handler(Looper.getMainLooper()))
        check(copied) { "Robolectric PixelCopy did not complete" }
        image
    }
    val destination = File("build/outputs/demo-screenshots/$name.png")
    checkNotNull(destination.parentFile).mkdirs()
    destination.outputStream().use {
        check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it))
    }
}
