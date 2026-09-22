package app.sixtyseconds.watermark

import android.graphics.BitmapFactory
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

    AsyncFunction("addWatermark") { videoUri: String, watermarkUri: String, position: String, opacity: Double, scale: Double, promise: Promise ->
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
    val bitmap = BitmapFactory.decodeFile(logoPath) ?: run {
      promise.reject("E_FILE_NOT_FOUND", "The watermark image could not be loaded", null)
      return
    }

    val anchor = when (position) {
      "top-left" -> floatArrayOf(-0.94f, 0.94f)
      "top-right" -> floatArrayOf(0.94f, 0.94f)
      "bottom-left" -> floatArrayOf(-0.94f, -0.94f)
      "center" -> floatArrayOf(0f, 0f)
      else -> floatArrayOf(0.94f, -0.94f)
    }
    val overlayAnchorX = if (anchor[0] < 0) -1f else if (anchor[0] > 0) 1f else 0f
    val overlayAnchorY = if (anchor[1] < 0) -1f else if (anchor[1] > 0) 1f else 0f
    val safeScale = scale.coerceIn(0.04, 0.12).toFloat()
    val settings = StaticOverlaySettings.Builder()
      .setAlphaScale(opacity.coerceIn(0.15, 1.0).toFloat())
      .setScale(safeScale, safeScale)
      .setOverlayFrameAnchor(overlayAnchorX, overlayAnchorY)
      .setBackgroundFrameAnchor(anchor[0], anchor[1])
      .build()
    val overlay = BitmapOverlay.createStaticBitmapOverlay(bitmap, settings)
    val effects = Effects(emptyList(), listOf<Effect>(OverlayEffect(listOf(overlay))))
    val editedMediaItem = EditedMediaItem.Builder(MediaItem.fromUri(video))
      .setEffects(effects)
      .build()
    val output = File(context.cacheDir, "watermarked_${UUID.randomUUID()}.mp4")
    output.delete()

    context.mainExecutor.execute {
      val transformer = Transformer.Builder(context)
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
    }
  }
}
