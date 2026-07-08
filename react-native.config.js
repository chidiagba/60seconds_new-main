module.exports = {
	dependencies: {
		// Disable @fathah package native autolinking to avoid duplicate/conflicting native modules.
		'@fathah_cr/react-native-ffmpeg-kit': {
			platforms: {
				ios: null,
				android: null,
			},
		},
		// Enable ffmpeg-kit-react-native for iOS.
		'ffmpeg-kit-react-native': {
			platforms: {
				android: null,
			},
		},
	},
};
