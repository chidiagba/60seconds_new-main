import AVFoundation
import CoreImage
import ExpoModulesCore
import UIKit

public final class NativeVideoWatermarkModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NativeVideoWatermark")

    AsyncFunction("addWatermark") {
      (videoUri: String, watermarkUri: String, position: String, opacity: Double, scale: Double, promise: Promise) in
      self.exportWatermarkedVideo(
        videoUri: videoUri,
        watermarkUri: watermarkUri,
        position: position,
        opacity: opacity,
        scale: scale,
        promise: promise
      )
    }
  }

  private func fileURL(_ value: String) -> URL? {
    if let url = URL(string: value), url.isFileURL { return url }
    return URL(fileURLWithPath: value.replacingOccurrences(of: "file://", with: ""))
  }

  private func exportWatermarkedVideo(
    videoUri: String,
    watermarkUri: String,
    position: String,
    opacity: Double,
    scale: Double,
    promise: Promise
  ) {
    guard let videoURL = fileURL(videoUri), let logoURL = fileURL(watermarkUri) else {
      promise.reject("E_INVALID_URI", "Video and watermark must be local file URLs")
      return
    }
    guard FileManager.default.fileExists(atPath: videoURL.path),
          let logo = UIImage(contentsOfFile: logoURL.path),
          let logoCGImage = logo.cgImage else {
      promise.reject("E_FILE_NOT_FOUND", "The local video or watermark image could not be loaded")
      return
    }

    let asset = AVURLAsset(url: videoURL)
    guard !asset.tracks(withMediaType: .video).isEmpty else {
      promise.reject("E_NO_VIDEO", "The source has no video track")
      return
    }

    // AVVideoCompositionCoreAnimationTool crashes in the iOS simulator (and can
    // exhaust IOSurface memory on devices) for some large/long source videos.
    // Composite the static logo with Core Image instead. This stays inside the
    // video compositor, preserves the asset's preferred transform and avoids a
    // second full-resolution Core Animation surface for every frame.
    let durationSeconds = CMTimeGetSeconds(asset.duration)
    guard durationSeconds.isFinite, durationSeconds > 0 else {
      promise.reject("E_DURATION", "The source video duration is invalid")
      return
    }
    let logoStartSeconds = max(0, durationSeconds - 1)
    let logoImage = CIImage(cgImage: logoCGImage)
    let safeScale = CGFloat(max(0.04, min(0.12, scale)))
    let safeOpacity = CGFloat(max(0.15, min(1, opacity)))
    let videoComposition = AVVideoComposition(asset: asset) { request in
      autoreleasepool {
        let source = request.sourceImage
        guard CMTimeGetSeconds(request.compositionTime) >= logoStartSeconds else {
          request.finish(with: source, context: nil)
          return
        }
        let extent = source.extent.integral
        guard extent.width > 0, extent.height > 0, logoImage.extent.width > 0 else {
          request.finish(with: source, context: nil)
          return
        }

        let logoWidth = extent.width * safeScale
        let logoScale = logoWidth / logoImage.extent.width
        var renderedLogo = logoImage.transformed(by: CGAffineTransform(scaleX: logoScale, y: logoScale))
        if safeOpacity < 1,
           let alphaFilter = CIFilter(name: "CIColorMatrix") {
          alphaFilter.setValue(renderedLogo, forKey: kCIInputImageKey)
          alphaFilter.setValue(CIVector(x: 0, y: 0, z: 0, w: safeOpacity), forKey: "inputAVector")
          renderedLogo = alphaFilter.outputImage ?? renderedLogo
        }

        let logoSize = renderedLogo.extent.size
        let margin = max(12, extent.width * 0.017)
        let origin: CGPoint
        switch position {
        case "top-left":
          origin = CGPoint(x: extent.minX + margin, y: extent.maxY - logoSize.height - margin)
        case "top-right":
          origin = CGPoint(x: extent.maxX - logoSize.width - margin, y: extent.maxY - logoSize.height - margin)
        case "bottom-left":
          origin = CGPoint(x: extent.minX + margin, y: extent.minY + margin)
        case "center":
          origin = CGPoint(x: extent.midX - logoSize.width / 2, y: extent.midY - logoSize.height / 2)
        default:
          origin = CGPoint(x: extent.maxX - logoSize.width - margin, y: extent.minY + margin)
        }

        renderedLogo = renderedLogo.transformed(by: CGAffineTransform(
          translationX: origin.x - renderedLogo.extent.minX,
          y: origin.y - renderedLogo.extent.minY
        ))
        let output = renderedLogo.composited(over: source).cropped(to: extent)
        request.finish(with: output, context: nil)
      }
    }

    guard let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHighestQuality) else {
      promise.reject("E_EXPORTER", "This video cannot be exported")
      return
    }
    let outputFileType: AVFileType
    let outputExtension: String
    if exporter.supportedFileTypes.contains(.mp4) {
      outputFileType = .mp4
      outputExtension = "mp4"
    } else if exporter.supportedFileTypes.contains(.mov) {
      outputFileType = .mov
      outputExtension = "mov"
    } else {
      promise.reject("E_OUTPUT_TYPE", "This video cannot be exported as MP4 or MOV")
      return
    }
    let outputURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("watermarked_\(UUID().uuidString).\(outputExtension)")
    try? FileManager.default.removeItem(at: outputURL)
    exporter.outputURL = outputURL
    exporter.outputFileType = outputFileType
    exporter.shouldOptimizeForNetworkUse = true
    exporter.videoComposition = videoComposition
    exporter.exportAsynchronously {
      switch exporter.status {
      case .completed: promise.resolve(outputURL.absoluteString)
      case .cancelled: promise.reject("E_CANCELLED", "Video watermark export was cancelled")
      default: promise.reject("E_EXPORT", exporter.error?.localizedDescription ?? "Video watermark export failed")
      }
    }
  }
}
