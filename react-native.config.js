module.exports = {
	dependencies: {
		// Disable @fathah package native autolinking to avoid duplicate/conflicting native modules.
		'@fathah_cr/react-native-ffmpeg-kit': {
			platforms: {
				ios: null,
				android: null,
			},
		},
		// Keep FFmpeg linked on both platforms. It is the compatibility fallback
		// when Media3/AVFoundation cannot decode a device-specific source video.
		'ffmpeg-kit-react-native': {},
	},
};
