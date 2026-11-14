import AVFoundation
import CoreImage
import ExpoModulesCore
import UIKit

public final class NativeVideoWatermarkModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NativeVideoWatermark")

    AsyncFunction("createWatermarkImage") { (logoUri: String, username: String) -> String in
      guard let url = self.fileURL(logoUri), let logo = UIImage(contentsOfFile: url.path) else {
        throw NSError(domain: "Watermark", code: 1, userInfo: [NSLocalizedDescriptionKey: "Logo could not be loaded"])
      }
      let format = UIGraphicsImageRendererFormat()
      format.scale = 1
      format.opaque = false
      let image = UIGraphicsImageRenderer(size: CGSize(width: 560, height: 144), format: format).image { context in
        let ratio = min(96 / logo.size.width, 96 / logo.size.height)
        logo.draw(in: CGRect(x: 8, y: 24, width: logo.size.width * ratio, height: logo.size.height * ratio))
        let shadow = NSShadow()
        shadow.shadowColor = UIColor.black.withAlphaComponent(0.9)
        shadow.shadowBlurRadius = 3
        shadow.shadowOffset = CGSize(width: 1, height: 2)
        let brand: [NSAttributedString.Key: Any] = [.font: UIFont.boldSystemFont(ofSize: 42), .foregroundColor: UIColor.white, .shadow: shadow]
        ("60Seconds" as NSString).draw(at: CGPoint(x: 116, y: 26), withAttributes: brand)
        let text = username as NSString
        let fontSize = min(30, 432 / max(1, text.size(withAttributes: [.font: UIFont.systemFont(ofSize: 30, weight: .semibold)]).width) * 30)
        text.draw(at: CGPoint(x: 116, y: 80), withAttributes: [.font: UIFont.systemFont(ofSize: fontSize, weight: .semibold), .foregroundColor: UIColor.white, .shadow: shadow])
      }
      let output = FileManager.default.temporaryDirectory.appendingPathComponent("wm_brand_\(UUID().uuidString).png")
      guard let png = image.pngData() else { throw NSError(domain: "Watermark", code: 2) }
      try png.write(to: output)
      return output.absoluteString
    }

    AsyncFunction("exportBrandedVideo") {
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
    guard let videoTrack = asset.tracks(withMediaType: .video).first else {
      promise.reject("E_NO_VIDEO", "The source has no video track")
      return
    }

    let durationSeconds = CMTimeGetSeconds(asset.duration)
    guard durationSeconds.isFinite, durationSeconds > 0 else {
      promise.reject("E_DURATION", "The source video duration is invalid")
      return
    }
    let logoImage = CIImage(cgImage: logoCGImage)
    let safeScale = CGFloat(max(0.18, min(0.36, scale)))
    let safeOpacity = CGFloat(max(0.15, min(1, opacity)))
    let videoComposition = AVVideoComposition(asset: asset) { request in
      autoreleasepool {
        let source = request.sourceImage
        let extent = source.extent.integral
        guard extent.width > 0, extent.height > 0, logoImage.extent.width > 0 else {
          request.finish(with: NSError(domain: "Watermark", code: 3, userInfo: [NSLocalizedDescriptionKey: "Invalid watermark frame dimensions"]))
          return
        }

        let shortSide = min(extent.width, extent.height)
        let logoWidth = min(shortSide * 0.45, max(160, shortSide * safeScale))
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
        // Keep exported watermarks fixed so the brand stays readable while the
        // video is shared to apps that re-encode or crop the source.
        let origin = CGPoint(x: extent.maxX - logoSize.width - margin,
                             y: extent.minY + margin)

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
    guard exporter.supportedFileTypes.contains(.mp4) else {
      promise.reject("E_OUTPUT_TYPE", "This video cannot be exported as MP4")
      return
    }
    let outputFileType: AVFileType = .mp4
    let outputExtension = "mp4"
    let outputURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("watermarked_\(UUID().uuidString).\(outputExtension)")
    try? FileManager.default.removeItem(at: outputURL)
    exporter.outputURL = outputURL
    exporter.outputFileType = outputFileType
    exporter.shouldOptimizeForNetworkUse = true
    if let composition = videoComposition.mutableCopy() as? AVMutableVideoComposition {
      let transformed = videoTrack.naturalSize.applying(videoTrack.preferredTransform)
      composition.renderSize = CGSize(width: abs(transformed.width), height: abs(transformed.height))
      if videoTrack.minFrameDuration.isValid && videoTrack.minFrameDuration.seconds > 0 {
        composition.frameDuration = videoTrack.minFrameDuration
      } else if videoTrack.nominalFrameRate > 0 {
        composition.frameDuration = CMTime(seconds: 1 / Double(videoTrack.nominalFrameRate), preferredTimescale: 60000)
      }
      exporter.videoComposition = composition
    } else {
      promise.reject("E_COMPOSITION", "The watermark composition could not be prepared")
      return
    }
    exporter.exportAsynchronously {
      switch exporter.status {
      case .completed:
        let exportedAsset = AVURLAsset(url: outputURL)
        guard let exportedTrack = exportedAsset.tracks(withMediaType: .video).first else {
          try? FileManager.default.removeItem(at: outputURL)
          promise.reject("E_OUTPUT_VIDEO", "The exported video track is missing")
          return
        }
        let expected = videoTrack.naturalSize.applying(videoTrack.preferredTransform)
        let actual = exportedTrack.naturalSize.applying(exportedTrack.preferredTransform)
        guard abs(abs(expected.width) - abs(actual.width)) < 1,
              abs(abs(expected.height) - abs(actual.height)) < 1,
              exportedAsset.tracks(withMediaType: .audio).count >= asset.tracks(withMediaType: .audio).count else {
          try? FileManager.default.removeItem(at: outputURL)
          promise.reject("E_OUTPUT_QUALITY", "The exporter changed the source dimensions or removed audio")
          return
        }
        guard outputURL.pathExtension.lowercased() == "mp4",
              let outputAttributes = try? FileManager.default.attributesOfItem(atPath: outputURL.path),
              let outputSize = outputAttributes[.size] as? NSNumber,
              outputSize.intValue > 1024 else {
          try? FileManager.default.removeItem(at: outputURL)
          promise.reject("E_OUTPUT_FILE", "The MP4 export is missing or incomplete")
          return
        }
        promise.resolve(outputURL.absoluteString)
      case .cancelled:
        try? FileManager.default.removeItem(at: outputURL)
        promise.reject("E_CANCELLED", "Video watermark export was cancelled")
      default:
        try? FileManager.default.removeItem(at: outputURL)
        promise.reject("E_EXPORT", exporter.error?.localizedDescription ?? "Video watermark export failed")
      }
    }
  }
}
