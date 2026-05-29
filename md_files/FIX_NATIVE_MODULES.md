# Fix Native Module Errors

## Problem
You're getting errors:
- `Cannot find native module 'ExpoLocation'`
- `Cannot find native module 'ExponentAV'`

This happens because native modules need to be rebuilt after installation.

## Solution

### Option 1: Clear Cache and Rebuild (Recommended)

1. **Stop the Expo dev server** (Ctrl+C)

2. **Clear Expo cache:**
   ```bash
   npx expo start --clear
   ```

3. **If using development build, rebuild:**
   ```bash
   # For Android
   npx expo run:android
   
   # For iOS
   npx expo run:ios
   ```

### Option 2: Prebuild and Rebuild

If you have native folders (android/ios):

1. **Clean build folders:**
   ```bash
   # Android
   cd android && ./gradlew clean && cd ..
   
   # iOS
   cd ios && pod install && cd ..
   ```

2. **Rebuild:**
   ```bash
   npx expo prebuild --clean
   npx expo run:android  # or run:ios
   ```

### Option 3: Development Build (EAS)

If you're using EAS Build:

```bash
# Build a new development build
eas build --profile development --platform android
# or
eas build --profile development --platform ios
```

### Quick Fix (If using Expo Go)

**Note:** Expo Go has limitations with custom native modules. If you're using Expo Go, you need to create a development build instead:

```bash
npx expo install expo-dev-client
npx expo run:android  # This creates a custom dev client
```

## After Rebuilding

1. Start the dev server:
   ```bash
   npx expo start
   ```

2. Open the app on your device/emulator

The native modules should now be available.

## Verify Installation

The packages are already in your `package.json`:
- ✅ `expo-av`: ~15.1.4
- ✅ `expo-location`: ~18.1.5

And configured in `app.json` plugins, so after rebuilding, they should work.










