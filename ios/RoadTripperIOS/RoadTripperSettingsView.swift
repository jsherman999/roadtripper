import SwiftUI

struct RoadTripperSettingsView: View {
    @ObservedObject var settingsStore: RoadTripperLLMSettingsStore
    let initialAudienceBand: AudienceBand
    let initialNarrationMode: NarrationMode
    let onSave: (AudienceBand, NarrationMode) -> Void
    let onClose: () -> Void

    @State private var audienceBand: AudienceBand
    @State private var narrationMode: NarrationMode
    @State private var provider: LLMProviderKind
    @State private var model: String
    @State private var ttsProvider: TTSProviderKind
    @State private var ttsModel: String
    @State private var ttsVoice: String
    @State private var openAIAPIKey: String
    @State private var openRouterAPIKey: String

    init(
        settingsStore: RoadTripperLLMSettingsStore,
        initialAudienceBand: AudienceBand,
        initialNarrationMode: NarrationMode,
        onSave: @escaping (AudienceBand, NarrationMode) -> Void,
        onClose: @escaping () -> Void
    ) {
        self.settingsStore = settingsStore
        self.initialAudienceBand = initialAudienceBand
        self.initialNarrationMode = initialNarrationMode
        self.onSave = onSave
        self.onClose = onClose

        let configuration = settingsStore.configuration
        let ttsConfiguration = settingsStore.ttsConfiguration
        _audienceBand = State(initialValue: initialAudienceBand)
        _narrationMode = State(initialValue: initialNarrationMode)
        _provider = State(initialValue: configuration.provider)
        _model = State(initialValue: configuration.model)
        _ttsProvider = State(initialValue: ttsConfiguration.provider)
        _ttsModel = State(initialValue: ttsConfiguration.model)
        _ttsVoice = State(initialValue: ttsConfiguration.voice)
        _openAIAPIKey = State(initialValue: configuration.openAIAPIKey)
        _openRouterAPIKey = State(initialValue: configuration.openRouterAPIKey)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Trip Style") {
                    Picker("Audience", selection: $audienceBand) {
                        ForEach(AudienceBand.allCases) { band in
                            Text(band.title).tag(band)
                        }
                    }

                    Picker("Narration mode", selection: $narrationMode) {
                        ForEach(NarrationMode.allCases) { mode in
                            Text(mode.title).tag(mode)
                        }
                    }
                }

                Section("Provider") {
                    Picker("Narration provider", selection: $provider) {
                        ForEach(LLMProviderKind.allCases) { kind in
                            Text(kind.title).tag(kind)
                        }
                    }
                    .pickerStyle(.navigationLink)

                    if provider == .none {
                        Text("Use the built-in on-device narration logic with no external model calls.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        Picker("Model", selection: $model) {
                            ForEach(modelOptions) { option in
                                Text(option.name).tag(option.id)
                            }
                        }

                        if settingsStore.isLoadingModels {
                            ProgressView("Loading models...")
                        } else if !settingsStore.lastLoadError.isEmpty {
                            Text(settingsStore.lastLoadError)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }

                        if provider == .openrouter {
                            Button("Refresh free models") {
                                Task {
                                    await loadModels(for: provider)
                                }
                            }
                        }
                    }
                }

                Section("Voice Output") {
                    Picker("Voice provider", selection: $ttsProvider) {
                        ForEach(TTSProviderKind.allCases) { kind in
                            Text(kind.title).tag(kind)
                        }
                    }
                    .pickerStyle(.navigationLink)

                    if ttsProvider == .openai {
                        Picker("Voice model", selection: $ttsModel) {
                            ForEach(RoadTripperTTSConfiguration.openAIModelOptions) { option in
                                Text(option.name).tag(option.id)
                            }
                        }

                        Picker("Voice", selection: $ttsVoice) {
                            ForEach(RoadTripperTTSConfiguration.openAIVoiceOptions) { option in
                                Text(option.name).tag(option.id)
                            }
                        }

                        Text("OpenAI voices are AI-generated and should be disclosed as such to end users.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("Use iOS system speech as the local fallback voice.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                if provider == .openai || provider == .none {
                    Section("OpenAI") {
                        SecureField("OpenAI API key", text: $openAIAPIKey)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Text("Stored in Keychain on this device.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                if provider == .openrouter || provider == .none {
                    Section("OpenRouter") {
                        SecureField("OpenRouter API key", text: $openRouterAPIKey)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Text("Stored in Keychain on this device.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Narration Settings")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        onClose()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        saveAndClose()
                    }
                }
            }
            .task {
                await loadModels(for: provider)
            }
            .onChange(of: provider) { _, newProvider in
                Task {
                    if model.isEmpty || !modelOptions.contains(where: { $0.id == model }) {
                        model = RoadTripperLLMConfiguration.defaultModel(for: newProvider)
                    }
                    await loadModels(for: newProvider)
                    if !modelOptions.contains(where: { $0.id == model }), let first = modelOptions.first {
                        model = first.id
                    }
                }
            }
            .onChange(of: ttsProvider) { _, newProvider in
                if ttsModel.isEmpty || !RoadTripperTTSConfiguration.openAIModelOptions.contains(where: { $0.id == ttsModel }) {
                    ttsModel = RoadTripperTTSConfiguration.defaultModel(for: newProvider)
                }
                if ttsVoice.isEmpty || !RoadTripperTTSConfiguration.openAIVoiceOptions.contains(where: { $0.id == ttsVoice }) {
                    ttsVoice = RoadTripperTTSConfiguration.defaultVoice
                }
            }
        }
    }

    private var modelOptions: [LLMModelOption] {
        switch provider {
        case .none:
            return []
        case .openai:
            return RoadTripperLLMSettingsStore.openAIModelOptions
        case .openrouter:
            return settingsStore.availableModels.isEmpty
                ? [.init(id: RoadTripperLLMConfiguration.defaultModel(for: .openrouter), name: RoadTripperLLMConfiguration.defaultModel(for: .openrouter))]
                : settingsStore.availableModels
        }
    }

    private func loadModels(for provider: LLMProviderKind) async {
        await settingsStore.previewModelOptions(
            for: provider,
            openAIAPIKey: openAIAPIKey,
            openRouterAPIKey: openRouterAPIKey
        )
    }

    private func saveAndClose() {
        let nextConfiguration = RoadTripperLLMConfiguration(
            provider: provider,
            model: model,
            openAIAPIKey: openAIAPIKey,
            openRouterAPIKey: openRouterAPIKey
        ).normalized()
        settingsStore.save(
            provider: nextConfiguration.provider,
            model: nextConfiguration.model,
            openAIAPIKey: nextConfiguration.openAIAPIKey,
            openRouterAPIKey: nextConfiguration.openRouterAPIKey
            ,
            ttsProvider: ttsProvider,
            ttsModel: ttsModel,
            ttsVoice: ttsVoice
        )
        onSave(audienceBand, narrationMode)
        onClose()
    }
}
