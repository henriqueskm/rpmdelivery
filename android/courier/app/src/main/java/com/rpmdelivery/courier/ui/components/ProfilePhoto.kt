package com.rpmdelivery.courier.ui.components

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import androidx.core.graphics.scale
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min

/**
 * Turns the picked image into what the stores see: a centered square JPEG of at most [SIZE] px,
 * well under the bucket's 1 MB limit. Only the cropped pixels leave the phone (no EXIF, no location).
 */
object ProfilePhoto {
    const val SIZE = 512
    private const val MAX_BYTES = 900_000

    /** null when the image cannot be read. Call off the main thread. */
    fun squareJpeg(resolver: ContentResolver, uri: Uri): ByteArray? = try {
        decode(resolver, uri)?.let { squareJpeg(it) }
    } catch (_: Exception) { null } catch (_: OutOfMemoryError) { null }

    fun squareJpeg(source: Bitmap): ByteArray {
        val side = min(source.width, source.height)
        val square = Bitmap.createBitmap(source, (source.width - side) / 2, (source.height - side) / 2, side, side)
        val target = min(SIZE, side)
        val scaled = if (target == side) square else square.scale(target, target)
        var quality = 85
        while (true) {
            val bytes = ByteArrayOutputStream().also { scaled.compress(Bitmap.CompressFormat.JPEG, quality, it) }.toByteArray()
            if (bytes.size <= MAX_BYTES || quality <= 40) return bytes
            quality -= 15
        }
    }

    /** Big camera photos are decoded already reduced; ImageDecoder also applies the EXIF rotation. */
    private fun decode(resolver: ContentResolver, uri: Uri): Bitmap? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri)) { decoder, info, _ ->
                val shorter = min(info.size.width, info.size.height)
                if (shorter > SIZE * 2) {
                    val factor = shorter / (SIZE * 2).toFloat()
                    decoder.setTargetSize(max(1, (info.size.width / factor).toInt()), max(1, (info.size.height / factor).toInt()))
                }
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        val shorter = min(bounds.outWidth, bounds.outHeight)
        if (shorter <= 0) return null
        var sample = 1
        while (shorter / (sample * 2) >= SIZE) sample *= 2
        return resolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        }
    }
}
