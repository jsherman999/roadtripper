import Foundation
import Security

@MainActor
final class RoadTripperLLMSettingsStore: ObservableObject {
    @Published private(set) var configuration: RoadTripperLLMConfiguration
    @Published private(set) var ttsConfiguration: RoadTripperTTSConfiguration
    @Published private(set) var availableModels: [LLMModelOption] = []
    @Published private(set) var isLoadingModels = false
    @Published private(set) var lastLoadError = ""

    private let defaults: UserDefaults
    private let keychain: RoadTripperKeychainStore

    init(
        defaults: UserDefaults = .standard,
        keychain: RoadTripperKeychainStore = RoadTripperKeychainStore(service: "com.jsherman999.RoadTripperIOS")
    ) {
        self.defaults = defaults
        self.keychain = keychain

        let environment = RoadTripperAppEnvironment.currentLLMConfiguration()
        let environmentTTS = RoadTripperAppEnvironment.currentTTSConfiguration()
        let storedProvider = LLMProviderKind(
            rawValue: defaults.string(forKey: Keys.provider)?.lowercased() ?? ""
        ) ?? environment.provider
        let storedModel = defaults.string(forKey: Keys.model) ?? environment.model
        let storedTTSProvider = TTSProviderKind(
            rawValue: defaults.string(forKey: Keys.ttsProvider)?.lowercased() ?? ""
        ) ?? environmentTTS.provider
        let storedTTSModel = defaults.string(forKey: Keys.ttsModel) ?? environmentTTS.model
        let storedTTSVoice = defaults.string(forKey: Keys.ttsVoice) ?? environmentTTS.voice
        let openAIKey = keychain.string(forKey: Keys.openAIKey) ?? environment.openAIAPIKey
        let openRouterKey = keychain.string(forKey: Keys.openRouterKey) ?? environment.openRouterAPIKey

        self.configuration = RoadTripperLLMConfiguration(
            provider: storedProvider,
            model: storedModel,
            openAIAPIKey: openAIKey,
            openRouterAPIKey: openRouterKey
        ).normalized()
        self.ttsConfiguration = RoadTripperTTSConfiguration(
            provider: storedTTSProvider,
            model: storedTTSModel,
            voice: storedTTSVoice
        ).normalized()
    }

    func refreshModelOptions() async {
        await previewModelOptions(
            for: configuration.provider,
            openAIAPIKey: configuration.openAIAPIKey,
            openRouterAPIKey: configuration.openRouterAPIKey
        )
    }

    func previewModelOptions(
        for provider: LLMProviderKind,
        openAIAPIKey: String,
        openRouterAPIKey: String
    ) async {
        isLoadingModels = true
        lastLoadError = ""

        switch provider {
        case .none:
            availableModels = []
        case .openai:
            availableModels = Self.openAIModelOptions
        case .openrouter:
            let provider = OpenRouterNarrationLLMProvider(
                apiKey: openRouterAPIKey,
                model: configuration.model.isEmpty ? RoadTripperLLMConfiguration.defaultModel(for: .openrouter) : configuration.model
            )
            let models = await provider.listFreeModels()
            availableModels = models
        }

        isLoadingModels = false
    }

    func save(
        provider: LLMProviderKind,
        model: String,
        openAIAPIKey: String,
        openRouterAPIKey: String,
        ttsProvider: TTSProviderKind,
        ttsModel: String,
        ttsVoice: String
    ) {
        let nextConfiguration = RoadTripperLLMConfiguration(
            provider: provider,
            model: model,
            openAIAPIKey: openAIAPIKey,
            openRouterAPIKey: openRouterAPIKey
        ).normalized()
        let nextTTSConfiguration = RoadTripperTTSConfiguration(
            provider: ttsProvider,
            model: ttsModel,
            voice: ttsVoice
        ).normalized()

        defaults.set(nextConfiguration.provider.rawValue, forKey: Keys.provider)
        defaults.set(nextConfiguration.model, forKey: Keys.model)
        defaults.set(nextTTSConfiguration.provider.rawValue, forKey: Keys.ttsProvider)
        defaults.set(nextTTSConfiguration.model, forKey: Keys.ttsModel)
        defaults.set(nextTTSConfiguration.voice, forKey: Keys.ttsVoice)

        persistKey(nextConfiguration.openAIAPIKey, key: Keys.openAIKey)
        persistKey(nextConfiguration.openRouterAPIKey, key: Keys.openRouterKey)

        configuration = nextConfiguration
        ttsConfiguration = nextTTSConfiguration
    }

    func summaryText() -> String {
        let narrationSummary: String
        switch configuration.provider {
        case .none:
            narrationSummary = "Built-in narration"
        case .openai:
            narrationSummary = "OpenAI text, model \(configuration.model)"
        case .openrouter:
            narrationSummary = "OpenRouter text, model \(configuration.model)"
        }

        let voiceSummary: String
        switch ttsConfiguration.provider {
        case .native:
            voiceSummary = "native voice"
        case .openai:
            voiceSummary = "OpenAI voice \(ttsConfiguration.voice)"
        }

        return "\(narrationSummary); \(voiceSummary)"
    }

    private func persistKey(_ value: String, key: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            keychain.deleteValue(forKey: key)
        } else {
            keychain.setValue(trimmed, forKey: key)
        }
    }

    private enum Keys {
        static let provider = "RoadTripperLLMProvider"
        static let model = "RoadTripperLLMModel"
        static let ttsProvider = "RoadTripperTTSProvider"
        static let ttsModel = "RoadTripperTTSModel"
        static let ttsVoice = "RoadTripperTTSVoice"
        static let openAIKey = "RoadTripperOpenAIAPIKey"
        static let openRouterKey = "RoadTripperOpenRouterAPIKey"
    }

    static let openAIModelOptions: [LLMModelOption] = [
        .init(id: "gpt-4.1-mini", name: "gpt-4.1-mini"),
        .init(id: "gpt-4.1", name: "gpt-4.1"),
        .init(id: "gpt-4o-mini", name: "gpt-4o-mini"),
    ]
}

struct RoadTripperKeychainStore {
    let service: String

    func string(forKey key: String) -> String? {
        var query = baseQuery(forKey: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let data = item as? Data,
              let string = String(data: data, encoding: .utf8) else {
            return nil
        }
        return string
    }

    func setValue(_ value: String, forKey key: String) {
        let data = Data(value.utf8)
        let query = baseQuery(forKey: key)
        let attributes = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)

        if status == errSecItemNotFound {
            var createQuery = query
            createQuery[kSecValueData as String] = data
            SecItemAdd(createQuery as CFDictionary, nil)
        }
    }

    func deleteValue(forKey key: String) {
        let query = baseQuery(forKey: key)
        SecItemDelete(query as CFDictionary)
    }

    private func baseQuery(forKey key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }
}
