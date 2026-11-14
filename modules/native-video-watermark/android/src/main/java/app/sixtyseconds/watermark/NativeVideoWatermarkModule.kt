package app.sixtyseconds.watermark

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Color
import android.graphics.RectF
import android.graphics.Typeface
import androidx.media3.common.MimeTypes
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.VideoEncoderSettings
import android.media.MediaMetadataRetriever
import androidx.media3.common.OverlaySettings
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.StaticOverlaySettings
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID

class NativeVideoWatermarkModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NativeVideoWatermark")

    AsyncFunction("createWatermarkImage") { logoUri: String, username: String ->
      val context = appContext.reactContext ?: error("Android application context is unavailable")
      val logo = BitmapFactory.decodeFile(Uri.parse(logoUri).path) ?: error("Logo could not be loaded")
      val image = Bitmap.createBitmap(560, 144, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(image)
      val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
      val ratio = minOf(96f / logo.width, 96f / logo.height)
      canvas.drawBitmap(logo, null, RectF(8f, 24f, 8f + logo.width * ratio, 24f + logo.height * ratio), paint)
      paint.color = Color.WHITE
      paint.setShadowLayer(3f, 1f, 2f, Color.BLACK)
      paint.typeface = Typeface.create("sans-serif", Typeface.BOLD)
      paint.textSize = 42f
      canvas.drawText("60Seconds", 116f, 68f, paint)
      paint.typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
      paint.textSize = 30f
      paint.textSize = minOf(30f, 432f / paint.measureText(username).coerceAtLeast(1f) * 30f)
      canvas.drawText(username, 116f, 110f, paint)
      val output = File(context.cacheDir, "wm_brand_${UUID.randomUUID()}.png")
      try {
        output.outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
      } finally {
        image.recycle()
        logo.recycle()
      }
      Uri.fromFile(output).toString()
    }

    AsyncFunction("exportBrandedVideo") { videoUri: String, watermarkUri: String, position: String, opacity: Double, scale: Double, promise: Promise ->
      addWatermark(videoUri, watermarkUri, position, opacity, scale, promise)
    }
  }

  @OptIn(UnstableApi::class)
  private fun addWatermark(
    videoUri: String,
    watermarkUri: String,
    position: String,
    opacity: Double,
    scale: Double,
    promise: Promise
  ) {
    val context = appContext.reactContext ?: run {
      promise.reject("E_NO_CONTEXT", "Android application context is unavailable", null)
      return
    }
    val video = Uri.parse(videoUri)
    val logoPath = Uri.parse(watermarkUri).path ?: watermarkUri.removePrefix("file://")
    val originalBitmap = BitmapFactory.decodeFile(logoPath) ?: run {
      promise.reject("E_FILE_NOT_FOUND", "The watermark image could not be loaded", null)
      return
    }

    val retriever = MediaMetadataRetriever()
    val metadata = try {
      retriever.setDataSource(context, video)
      listOf(
        retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0,
        retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toLongOrNull() ?: 0,
        retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toLongOrNull() ?: 0,
        retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE)?.toLongOrNull() ?: 0
      )
    } catch (error: Exception) {
      listOf(0L, 0L, 0L, 0L)
    } finally {
      retriever.release()
    }
    if (metadata[0] <= 0 || metadata[1] <= 0 || metadata[2] <= 0) {
      originalBitmap.recycle()
      promise.reject("E_METADATA", "The source video metadata is invalid", null)
      return
    }
    val shortSide = minOf(metadata[1], metadata[2]).toDouble()
    val width = minOf(shortSide * 0.45, maxOf(160.0, shortSide * scale.coerceIn(0.18, 0.36))).toInt().coerceAtLeast(1)
    val height = (width.toDouble() * originalBitmap.height / originalBitmap.width).toInt().coerceAtLeast(1)
    val bitmap = Bitmap.createScaledBitmap(originalBitmap, width, height, true)
    if (bitmap !== originalBitmap) originalBitmap.recycle()
    val overlay = object : BitmapOverlay() {
      override fun getBitmap(presentationTimeUs: Long): Bitmap = bitmap
      override fun getOverlaySettings(presentationTimeUs: Long): OverlaySettings {
        val seconds = presentationTimeUs / 1_000_000.0
        val phase = (seconds / 4).toInt() % 4
        val corners = arrayOf(floatArrayOf(-1f, 1f), floatArrayOf(1f, 1f), floatArrayOf(1f, -1f), floatArrayOf(-1f, -1f))
        val from = corners[phase]
        val to = corners[(phase + 1) % 4]
        val progress = ((seconds % 4 - 3.5) / 0.5).coerceIn(0.0, 1.0)
        val eased = (progress * progress * (3 - 2 * progress)).toFloat()
        val x = from[0] + (to[0] - from[0]) * eased
        val y = from[1] + (to[1] - from[1]) * eased
        return StaticOverlaySettings.Builder()
          .setAlphaScale(opacity.coerceIn(0.5, 1.0).toFloat())
          .setOverlayFrameAnchor(x, y)
          .setBackgroundFrameAnchor(x * 0.94f, y * 0.94f)
          .build()
      }
    }
    val effects = Effects(emptyList(), listOf<Effect>(OverlayEffect(listOf(overlay))))
    val editedMediaItem = EditedMediaItem.Builder(MediaItem.fromUri(video))
      .setEffects(effects)
      .build()
    val output = File(context.cacheDir, "watermarked_${UUID.randomUUID()}.mp4")
    output.delete()

    Handler(Looper.getMainLooper()).post {
      try {
      val encoderFactory = DefaultEncoderFactory.Builder(context)
        .setEnableFallback(false)
        .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder()
          .setBitrate(metadata[3].coerceAtLeast((metadata[1] * metadata[2] * 8)).coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
          .build())
        .build()
      val transformer = Transformer.Builder(context)
        .setVideoMimeType(MimeTypes.VIDEO_H264)
        .setEncoderFactory(encoderFactory)
        .addListener(object : Transformer.Listener {
          override fun onCompleted(composition: androidx.media3.transformer.Composition, exportResult: ExportResult) {
            bitmap.recycle()
            promise.resolve(Uri.fromFile(output).toString())
          }

          override fun onError(
            composition: androidx.media3.transformer.Composition,
            exportResult: ExportResult,
            exportException: ExportException
          ) {
            bitmap.recycle()
            output.delete()
            promise.reject("E_EXPORT", exportException.message ?: "Video watermark export failed", exportException)
          }
        })
        .build()
      transformer.start(editedMediaItem, output.absolutePath)
      } catch (error: Exception) {
        bitmap.recycle()
        output.delete()
        promise.reject("E_EXPORT", "Video watermark export could not start", error)
      }
    }
  }
}
