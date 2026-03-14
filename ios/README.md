# RoadTripper iOS Scaffold

This folder contains the native SwiftUI scaffold for RoadTripper.

## Purpose
- Keep the existing Python/web app working exactly as it does today
- Add a separate native iOS client in the same repo
- Reuse the same product concepts while using Apple-native frameworks

## What Is Included
- `RoadTripperIOS.xcodeproj`
- SwiftUI app entry point
- MapKit-driven root view with an immersive map-first layout
- Core Location service shell
- Reverse geocoding and nearby search shell
- Native speech synthesis shell plus OpenAI TTS

## Open In Xcode
```bash
open "/Users/jay/Documents/Playground 8/ios/RoadTripperIOS.xcodeproj"
```

## Build From Terminal
```bash
xcodebuild -project "/Users/jay/Documents/Playground 8/ios/RoadTripperIOS.xcodeproj" -scheme RoadTripperIOS -destination "generic/platform=iOS Simulator" CODE_SIGNING_ALLOWED=NO build
```

## Install A Simulator Runtime
If Xcode says there is no valid iOS Simulator destination:

1. Open Xcode.
2. Go to `Xcode` -> `Settings`.
3. Open `Components` or `Platforms` depending on your Xcode version.
4. Find an iOS Simulator runtime such as `iOS 26.2` and click `Download`.
5. After it finishes, open `Window` -> `Devices and Simulators`.
6. In the `Simulators` tab, create an iPhone simulator if one does not already exist.

Helpful checks from Terminal:

```bash
xcrun simctl list runtimes
xcrun simctl list devices available
```

## Use A Physical iPhone As A Destination
You can also build to a real device:

1. Connect the iPhone by cable.
2. Unlock it and tap `Trust` if prompted.
3. Enable `Developer Mode` on the iPhone if iOS asks for it.
4. In Xcode, open `Window` -> `Devices and Simulators` and confirm the device appears.
5. Choose the device as the run destination in the Xcode toolbar.
6. Set your Apple developer team in the target signing settings before running.

## Native LLM Settings
The iOS scaffold now includes a native settings screen:

1. Launch the app.
2. Tap the settings button in the top-right corner.
3. Choose `Built-in`, `OpenAI`, or `OpenRouter`.
4. Pick a model.
5. Enter the corresponding API key.
6. Tap `Save`.

Behavior:
- Provider and model are persisted with `UserDefaults`.
- API keys are stored in the iOS Keychain.
- Changes apply to narration immediately without restarting the app.
- Voice output can now use either native iOS speech or OpenAI TTS.

## Default Startup Behavior
- On a physical iPhone, RoadTripper starts from the device's live location after location permission is granted.
- In the simulator, RoadTripper starts from Embarrass, Minnesota by default until you choose a simulated route or location.

## Native OpenAI TTS
The iOS scaffold now supports OpenAI speech playback through the native settings screen.

In the settings screen:
1. Set `Voice provider` to `OpenAI`.
2. Pick a TTS model such as `gpt-4o-mini-tts` or `tts-1-hd`.
3. Pick a voice.
4. Save.

Notes:
- The app reuses the saved OpenAI API key.
- OpenAI-generated voices should be disclosed to end users as AI-generated.
- If OpenAI TTS fails, the app falls back to native iOS speech.

The app still supports Xcode scheme environment variables as bootstrap defaults, but the native settings screen is now the primary configuration path.

## Current Limitations
- No persisted trip journal yet
- No background-safe trip behavior yet
- Nearby discovery still depends on live MapKit geocoding/search quality
- Native speech remains the fallback when OpenAI TTS is unavailable

## Next Good Steps
1. Add SwiftData persistence.
2. Add a trip archive/search screen on iOS.
3. Tune map-follow and narration cooldown behavior on a real device.
4. Explore background-safe road-trip behavior and CarPlay-friendly UX.
