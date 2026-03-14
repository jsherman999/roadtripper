import SwiftUI

@main
struct RoadTripperIOSApp: App {
    @StateObject private var settingsStore: RoadTripperLLMSettingsStore
    @StateObject private var viewModel: TripViewModel

    init() {
        let settingsStore = RoadTripperLLMSettingsStore()
        _settingsStore = StateObject(wrappedValue: settingsStore)
        _viewModel = StateObject(
            wrappedValue: TripViewModel(
                locationService: RoadTripperLocationService(),
                discoveryService: RoadTripperDiscoveryService(),
                narrationService: RoadTripperNarrationService(
                    llmConfiguration: settingsStore.configuration,
                    ttsConfiguration: settingsStore.ttsConfiguration
                )
            )
        )
    }

    var body: some Scene {
        WindowGroup {
            RoadTripperRootView(
                viewModel: viewModel,
                settingsStore: settingsStore
            )
            .task {
                await settingsStore.refreshModelOptions()
                viewModel.updateAIConfiguration(
                    llmConfiguration: settingsStore.configuration,
                    ttsConfiguration: settingsStore.ttsConfiguration
                )
            }
            .onChange(of: settingsStore.configuration) { _, newConfiguration in
                viewModel.updateAIConfiguration(
                    llmConfiguration: newConfiguration,
                    ttsConfiguration: settingsStore.ttsConfiguration
                )
            }
            .onChange(of: settingsStore.ttsConfiguration) { _, newConfiguration in
                viewModel.updateAIConfiguration(
                    llmConfiguration: settingsStore.configuration,
                    ttsConfiguration: newConfiguration
                )
            }
        }
    }
}
