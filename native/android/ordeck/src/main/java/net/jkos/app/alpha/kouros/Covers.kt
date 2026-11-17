package net.jkos.app.alpha.kouros

import net.jkos.app.alpha.*
import net.jkos.app.alpha.auth.*

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Cover art for the UI: fetched with the Bearer token (KourosApi.coverBytes), decoded at the size it
 * is drawn (BitmapFactory's inSampleSize), and kept in a memory LruCache bounded to an eighth
 * of the heap. No image library — this is the whole of what one would do here.
 */
object Covers {
    private val cache = object : LruCache<String, Bitmap>((Runtime.getRuntime().maxMemory() / 8 / 1024).toInt()) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount / 1024
    }

    /** A track's cover, or a book's when [book]. */
    suspend fun load(id: Long, sizePx: Int, book: Boolean = false): Bitmap? {
        val key = "${if (book) "b" else "t"}$id@$sizePx"
        cache.get(key)?.let { return it }
        return withContext(Dispatchers.IO) {
            val bytes = try {
                if (book) KourosApi.bookCoverBytes(id) else KourosApi.coverBytes(id)
            } catch (_: Exception) {
                null
            } ?: return@withContext null
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            var sample = 1
            while (bounds.outWidth / (sample * 2) >= sizePx && bounds.outHeight / (sample * 2) >= sizePx) sample *= 2
            val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
            bmp?.also { cache.put(key, it) }
        }
    }
}
