import AVFoundation
import Foundation

enum TTSProviderKind: String, CaseIterable, Identifiable {
    case native
    case openai

    var id: String { rawValue }

    var title: String {
        switch self {
        case .native:
            return "Native"
        case .openai:
            return "OpenAI"
        }
    }
}

struct RoadTripperTTSConfiguration: Equatable {
    var provider: TTSProviderKind = .native
    var model: String = ""
    var voice: String = ""

    func normalized() -> RoadTripperTTSConfiguration {
        var copy = self
        copy.model = copy.model.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.voice = copy.voice.trimmingCharacters(in: .whitespacesAndNewlines)
        if copy.model.isEmpty {
            copy.model = Self.defaultModel(for: copy.provider)
        }
        if copy.voice.isEmpty {
            copy.voice = Self.defaultVoice
        }
        return copy
    }

    static func defaultModel(for provider: TTSProviderKind) -> String {
        switch provider {
        case .native:
            return "system"
        case .openai:
            return "gpt-4o-mini-tts"
        }
    }

    static let defaultVoice = "sage"

    static let openAIModelOptions: [LLMModelOption] = [
        .init(id: "gpt-4o-mini-tts", name: "gpt-4o-mini-tts"),
        .init(id: "tts-1-hd", name: "tts-1-hd"),
        .init(id: "tts-1", name: "tts-1"),
    ]

    static let openAIVoiceOptions: [LLMModelOption] = [
        .init(id: "alloy", name: "Alloy"),
        .init(id: "ash", name: "Ash"),
        .init(id: "ballad", name: "Ballad"),
        .init(id: "cedar", name: "Cedar"),
        .init(id: "coral", name: "Coral"),
        .init(id: "echo", name: "Echo"),
        .init(id: "fable", name: "Fable"),
        .init(id: "marin", name: "Marin"),
        .init(id: "nova", name: "Nova"),
        .init(id: "onyx", name: "Onyx"),
        .init(id: "sage", name: "Sage"),
        .init(id: "shimmer", name: "Shimmer"),
        .init(id: "verse", name: "Verse"),
    ]
}

protocol OpenAITTSProviding {
    func synthesize(text: String, configuration: RoadTripperTTSConfiguration, instructions: String) async -> Data?
}

struct OpenAITTSProvider: OpenAITTSProviding {
    private let apiKey: String
    private let session: URLSession

    init(apiKey: String, session: URLSession = .shared) {
        self.apiKey = apiKey
        self.session = session
    }

    func synthesize(text: String, configuration: RoadTripperTTSConfiguration, instructions: String) async -> Data? {
        guard let url = URL(string: "https://api.openai.com/v1/audio/speech") else {
            return nil
        }

        let payload = OpenAITTSPayload(
            model: configuration.model,
            input: text,
            voice: configuration.voice,
            instructions: instructions,
            responseFormat: "aac"
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        do {
            request.httpBody = try JSONEncoder().encode(payload)
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse, 200..<300 ~= httpResponse.statusCode else {
                return nil
            }
            return data
        } catch {
            return nil
        }
    }
}

enum RoadTripperTTSProviderFactory {
    static func build(configuration: RoadTripperTTSConfiguration, openAIAPIKey: String) -> OpenAITTSProviding? {
        guard configuration.provider == .openai, !openAIAPIKey.isEmpty else {
            return nil
        }
        return OpenAITTSProvider(apiKey: openAIAPIKey)
    }
}

extension RoadTripperAppEnvironment {
    static func currentTTSConfiguration() -> RoadTripperTTSConfiguration {
        let environment = ProcessInfo.processInfo.environment
        let provider = TTSProviderKind(rawValue: environment["ROADTRIPPER_TTS_PROVIDER", default: "native"].lowercased()) ?? .native
        let model = environment["ROADTRIPPER_TTS_MODEL", default: ""]
        let voice = environment["ROADTRIPPER_TTS_VOICE", default: ""]
        return RoadTripperTTSConfiguration(provider: provider, model: model, voice: voice).normalized()
    }
}

private struct OpenAITTSPayload: Encodable {
    let model: String
    let input: String
    let voice: String
    let instructions: String
    let responseFormat: String

    enum CodingKeys: String, CodingKey {
        case model
        case input
        case voice
        case instructions
        case responseFormat = "response_format"
    }
}
