import Foundation

enum LLMProviderKind: String, CaseIterable, Identifiable {
    case none
    case openai
    case openrouter

    var id: String { rawValue }

    var title: String {
        switch self {
        case .none:
            return "Built-in"
        case .openai:
            return "OpenAI"
        case .openrouter:
            return "OpenRouter"
        }
    }
}

struct LLMModelOption: Identifiable, Hashable, Decodable {
    let id: String
    let name: String
}

struct RoadTripperLLMConfiguration: Equatable {
    var provider: LLMProviderKind = .none
    var model: String = ""
    var openAIAPIKey: String = ""
    var openRouterAPIKey: String = ""

    func normalized() -> RoadTripperLLMConfiguration {
        var copy = self
        copy.model = copy.model.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.openAIAPIKey = copy.openAIAPIKey.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.openRouterAPIKey = copy.openRouterAPIKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if copy.provider != .none && copy.model.isEmpty {
            copy.model = Self.defaultModel(for: copy.provider)
        }
        return copy
    }

    static func defaultModel(for provider: LLMProviderKind) -> String {
        switch provider {
        case .none:
            return ""
        case .openai:
            return "gpt-5.4-mini"
        case .openrouter:
            return "openai/gpt-5.4-mini"
        }
    }
}

struct NarrationLLMContext: Encodable {
    var ageBand: String
    var narrationMode: String
    var sourceKind: String
    var sourceName: String
    var region: String
    var detail: String

    enum CodingKeys: String, CodingKey {
        case ageBand = "age_band"
        case narrationMode = "narration_mode"
        case sourceKind = "source_kind"
        case sourceName = "source_name"
        case region
        case detail
    }
}

protocol NarrationLLMProvider {
    var providerName: String { get }
    func generateNarration(
        fallbackScript: String,
        context: NarrationLLMContext,
        modelOverride: String?
    ) async -> String?
    func listFreeModels() async -> [LLMModelOption]
}

struct NoOpNarrationLLMProvider: NarrationLLMProvider {
    let providerName = "none"

    func generateNarration(
        fallbackScript: String,
        context: NarrationLLMContext,
        modelOverride: String?
    ) async -> String? {
        nil
    }

    func listFreeModels() async -> [LLMModelOption] {
        []
    }
}

struct OpenAINarrationLLMProvider: NarrationLLMProvider {
    let providerName = "openai"

    private let apiKey: String
    private let model: String
    private let session: URLSession

    init(apiKey: String, model: String, session: URLSession = .shared) {
        self.apiKey = apiKey
        self.model = model
        self.session = session
    }

    func generateNarration(
        fallbackScript: String,
        context: NarrationLLMContext,
        modelOverride: String?
    ) async -> String? {
        guard let url = URL(string: "https://api.openai.com/v1/responses") else {
            return nil
        }

        let payload = OpenAIResponsesRequest(
            model: modelOverride?.isEmpty == false ? modelOverride! : model,
            instructions: systemPrompt(context: context),
            input: buildPrompt(fallbackScript: fallbackScript, context: context),
            temperature: 0.5
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
            let decoded = try JSONDecoder().decode(OpenAIResponsesResponse.self, from: data)
            if let outputText = decoded.outputText, !outputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return outputText.trimmingCharacters(in: .whitespacesAndNewlines)
            }
            for item in decoded.output {
                for content in item.content where content.type == "output_text" {
                    if let text = content.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
                        return text
                    }
                }
            }
            return nil
        } catch {
            return nil
        }
    }

    func listFreeModels() async -> [LLMModelOption] {
        []
    }
}

struct OpenRouterNarrationLLMProvider: NarrationLLMProvider {
    let providerName = "openrouter"

    private let apiKey: String
    private let model: String
    private let session: URLSession

    init(apiKey: String, model: String, session: URLSession = .shared) {
        self.apiKey = apiKey
        self.model = model
        self.session = session
    }

    func generateNarration(
        fallbackScript: String,
        context: NarrationLLMContext,
        modelOverride: String?
    ) async -> String? {
        guard let url = URL(string: "https://openrouter.ai/api/v1/chat/completions") else {
            return nil
        }

        let payload = OpenRouterChatRequest(
            model: modelOverride?.isEmpty == false ? modelOverride! : model,
            messages: [
                .init(role: "system", content: systemPrompt(context: context)),
                .init(role: "user", content: buildPrompt(fallbackScript: fallbackScript, context: context)),
            ],
            temperature: 0.5
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("https://roadtripper.local", forHTTPHeaderField: "HTTP-Referer")
        request.setValue("RoadTripper iOS", forHTTPHeaderField: "X-Title")

        do {
            request.httpBody = try JSONEncoder().encode(payload)
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse, 200..<300 ~= httpResponse.statusCode else {
                return nil
            }
            let decoded = try JSONDecoder().decode(OpenRouterChatResponse.self, from: data)
            let content = decoded.choices.first?.message.content?.trimmingCharacters(in: .whitespacesAndNewlines)
            return content?.isEmpty == false ? content : nil
        } catch {
            return nil
        }
    }

    func listFreeModels() async -> [LLMModelOption] {
        guard let url = URL(string: "https://openrouter.ai/api/v1/models") else {
            return [LLMModelOption(id: "openrouter/free", name: "OpenRouter Free")]
        }

        var request = URLRequest(url: url)
        request.setValue("https://roadtripper.local", forHTTPHeaderField: "HTTP-Referer")
        request.setValue("RoadTripper iOS", forHTTPHeaderField: "X-Title")

        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse, 200..<300 ~= httpResponse.statusCode else {
                return [LLMModelOption(id: "openrouter/free", name: "OpenRouter Free")]
            }
            let decoded = try JSONDecoder().decode(OpenRouterModelsResponse.self, from: data)
            var models = [LLMModelOption(id: "openrouter/free", name: "OpenRouter Free")]
            for item in decoded.data {
                let id = item.id
                let isFreeBySuffix = id.hasSuffix(":free")
                let promptCost = Double(item.pricing?.prompt ?? "1") ?? 1
                let completionCost = Double(item.pricing?.completion ?? "1") ?? 1
                let requestCost = Double(item.pricing?.request ?? "1") ?? 1
                if isFreeBySuffix || (promptCost == 0 && completionCost == 0 && requestCost == 0) {
                    models.append(.init(id: id, name: item.name ?? id))
                }
            }
            return uniqueModels(models)
        } catch {
            return [LLMModelOption(id: "openrouter/free", name: "OpenRouter Free")]
        }
    }

    private func uniqueModels(_ models: [LLMModelOption]) -> [LLMModelOption] {
        var seen = Set<String>()
        return models.filter { model in
            seen.insert(model.id).inserted
        }
    }
}

enum RoadTripperLLMProviderFactory {
    static func build(configuration: RoadTripperLLMConfiguration) -> NarrationLLMProvider {
        switch configuration.provider {
        case .openai:
            guard !configuration.openAIAPIKey.isEmpty else { return NoOpNarrationLLMProvider() }
            let model = configuration.model.isEmpty ? "gpt-5.4-mini" : configuration.model
            return OpenAINarrationLLMProvider(apiKey: configuration.openAIAPIKey, model: model)
        case .openrouter:
            guard !configuration.openRouterAPIKey.isEmpty else { return NoOpNarrationLLMProvider() }
            let model = configuration.model.isEmpty ? "openai/gpt-5.4-mini" : configuration.model
            return OpenRouterNarrationLLMProvider(apiKey: configuration.openRouterAPIKey, model: model)
        case .none:
            return NoOpNarrationLLMProvider()
        }
    }
}

enum RoadTripperAppEnvironment {
    static func currentLLMConfiguration() -> RoadTripperLLMConfiguration {
        let environment = ProcessInfo.processInfo.environment
        let provider = LLMProviderKind(rawValue: environment["ROADTRIPPER_LLM_PROVIDER", default: ""].lowercased()) ?? .none
        let model = environment["ROADTRIPPER_LLM_MODEL", default: ""]
        let openAIAPIKey = environment["ROADTRIPPER_OPENAI_API_KEY", default: ""]
        let openRouterAPIKey = environment["ROADTRIPPER_OPENROUTER_API_KEY", default: ""]
        return RoadTripperLLMConfiguration(
            provider: provider,
            model: model,
            openAIAPIKey: openAIAPIKey,
            openRouterAPIKey: openRouterAPIKey
        ).normalized()
    }
}

private func systemPrompt(context: NarrationLLMContext) -> String {
    let tone: String
    switch context.ageBand {
    case "adult":
        tone = "clear, engaging, and informative for adults"
    case "early_elementary":
        tone = "simple, upbeat, and easy for young children"
    default:
        tone = "friendly, age-appropriate, and fun for children"
    }
    return "You write short location-aware road trip narration. Stay factual, do not invent facts beyond the provided context, keep it to 2-5 concise sentences, and use a tone that is \(tone). If the context mentions a school district or high school enrollment, always include it."
}

private func buildPrompt(fallbackScript: String, context: NarrationLLMContext) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let contextJSON: String
    if let data = try? encoder.encode(context), let text = String(data: data, encoding: .utf8) {
        contextJSON = text
    } else {
        contextJSON = "{}"
    }

    return """
    Improve this fallback narration without inventing unsupported facts.

    Fallback script:
    \(fallbackScript)

    Context JSON:
    \(contextJSON)
    """
}

private struct OpenAIResponsesRequest: Encodable {
    let model: String
    let instructions: String
    let input: String
    let temperature: Double
}

private struct OpenAIResponsesResponse: Decodable {
    let outputText: String?
    let output: [OutputItem]

    enum CodingKeys: String, CodingKey {
        case outputText = "output_text"
        case output
    }

    struct OutputItem: Decodable {
        let content: [ContentItem]
    }

    struct ContentItem: Decodable {
        let type: String
        let text: String?
    }
}

private struct OpenRouterChatRequest: Encodable {
    let model: String
    let messages: [Message]
    let temperature: Double

    struct Message: Encodable {
        let role: String
        let content: String
    }
}

private struct OpenRouterChatResponse: Decodable {
    let choices: [Choice]

    struct Choice: Decodable {
        let message: Message
    }

    struct Message: Decodable {
        let content: String?
    }
}

private struct OpenRouterModelsResponse: Decodable {
    let data: [Model]

    struct Model: Decodable {
        let id: String
        let name: String?
        let pricing: Pricing?
    }

    struct Pricing: Decodable {
        let prompt: String?
        let completion: String?
        let request: String?
    }
}
