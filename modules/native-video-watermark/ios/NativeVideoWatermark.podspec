Pod::Spec.new do |s|
  s.name           = 'NativeVideoWatermark'
  s.version        = '1.0.0'
  s.summary        = 'On-device AVFoundation video watermarking for 60Seconds'
  s.description    = 'Burns an image watermark into a local video using AVFoundation.'
  s.author         = '60Seconds'
  s.homepage       = 'https://60secondsapp.io'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true
  s.source_files   = '**/*.{h,m,mm,swift}'
  s.frameworks     = 'AVFoundation', 'UIKit', 'QuartzCore'
  s.dependency 'ExpoModulesCore'
end
