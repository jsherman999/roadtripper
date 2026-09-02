// Bring-your-own-key narration for the browser-only edition.
//
// Keys never leave the browser except in the Authorization header of a
// request to the provider the traveler picked. Session storage keeps a key for
// one tab; "remember" moves it to local storage on this device.

const MODELS_TIMEOUT_MS = 20000;
const NARRATION_TIMEOUT_MS = 45000;
const SPEECH_TIMEOUT_MS = 30000;
const TTS_INPUT_LIMIT = 4096;
const KEY_PREFIX = "roadtripper-browser-llm-key-v1:";

export const PROVIDERS = {
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    chatUrl: "https://openrouter.ai/api/v1/chat/completions",
    keysUrl: "https://openrouter.ai/settings/keys",
    keyHint: "OpenRouter keys start with sk-or- and reach models from many vendors.",
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    modelsUrl: "https://api.openai.com/v1/models",
    chatUrl: "https://api.openai.com/v1/chat/completions",
    speechUrl: "https://api.openai.com/v1/audio/speech",
    keysUrl: "https://platform.openai.com/api-keys",
    keyHint: "OpenAI keys start with sk- and need access to chat models.",
  },
};

export const TTS_MODELS = [
  { id: "gpt-4o-mini-tts", name: "GPT-4o mini TTS · most natural, follows tone instructions" },
  { id: "tts-1-hd", name: "TTS-1 HD · high quality" },
  { id: "tts-1", name: "TTS-1 · fastest" },
];

const ALL_TTS_MODELS = "all";
const STEERABLE_ONLY = "steerable";

export const TTS_VOICES = [
  { id: "alloy", name: "Alloy", note: "balanced and neutral", models: ALL_TTS_MODELS },
  { id: "ash", name: "Ash", note: "confident and clear", models: ALL_TTS_MODELS },
  { id: "ballad", name: "Ballad", note: "expressive and melodic", models: STEERABLE_ONLY },
  { id: "cedar", name: "Cedar", note: "natural and grounded", models: STEERABLE_ONLY },
  { id: "coral", name: "Coral", note: "warm and friendly", models: ALL_TTS_MODELS },
  { id: "echo", name: "Echo", note: "calm and steady", models: ALL_TTS_MODELS },
  { id: "fable", name: "Fable", note: "storyteller with a British lilt", models: ALL_TTS_MODELS },
  { id: "marin", name: "Marin", note: "natural and conversational", models: STEERABLE_ONLY },
  { id: "nova", name: "Nova", note: "bright and upbeat", models: ALL_TTS_MODELS },
  { id: "onyx", name: "Onyx", note: "deep and authoritative", models: ALL_TTS_MODELS },
  { id: "sage", name: "Sage", note: "soft and even", models: ALL_TTS_MODELS },
  { id: "shimmer", name: "Shimmer", note: "light and cheerful", models: ALL_TTS_MODELS },
  { id: "verse", name: "Verse", note: "versatile and natural", models: STEERABLE_ONLY },
];

export function isSteerableSpeechModel(modelId) {
  return String(modelId || "").startsWith("gpt-");
}

export function voicesForModel(modelId) {
  const steerable = isSteerableSpeechModel(modelId);
  return TTS_VOICES.filter((voice) => voice.models === ALL_TTS_MODELS || steerable);
}

export function speechInstructions(ageBand = "adult", mode = "storyteller") {
  const audience = ageBand === "early_elementary" ? "young children" : ageBand === "elementary" ? "kids" : "adults and teens";
  const pace = mode === "quick" ? "brisk but clear" : "unhurried and natural";
  return `You are a warm road trip narrator reading aloud to ${audience} in a moving car. Use a ${pace} pace with light enthusiasm, pronounce place names clearly, and avoid theatrical exaggeration.`;
}

function safeStorage(candidate) {
  try {
    if (!candidate) return null;
    const probe = "__roadtripper_probe__";
    candidate.setItem(probe, "1");
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return null;
  }
}

export class KeyVault {
  constructor({ session, local } = {}) {
    this.session = safeStorage(session === undefined ? globalThis.sessionStorage : session);
    this.local = safeStorage(local === undefined ? globalThis.localStorage : local);
    this.memory = new Map();
  }

  read(providerId) {
    const name = KEY_PREFIX + providerId;
    const local = this.local?.getItem(name);
    if (local) return { key: local, remembered: true };
    const session = this.session?.getItem(name);
    if (session) return { key: session, remembered: false };
    return { key: this.memory.get(providerId) || "", remembered: false };
  }

  write(providerId, key, { remember = false } = {}) {
    const name = KEY_PREFIX + providerId;
    const value = String(key || "").trim();
    this.local?.removeItem(name);
    this.session?.removeItem(name);
    this.memory.delete(providerId);
    if (!value) return { key: "", remembered: false };
    const target = remember ? this.local : this.session;
    if (target) target.setItem(name, value);
    else this.memory.set(providerId, value);
    return { key: value, remembered: Boolean(remember && this.local) };
  }

  clear(providerId) {
    return this.write(providerId, "");
  }
}

const OPENAI_CHAT_PATTERN = /^(gpt-|o\d|chatgpt-)/i;
const OPENAI_NON_CHAT_PATTERN = /(audio|realtime|tts|transcribe|whisper|embedding|image|moderation|instruct|search|dall-e|davinci|babbage|codex|computer-use)/i;

export function isChatModel(providerId, id) {
  if (providerId !== "openai") return true;
  return OPENAI_CHAT_PATTERN.test(id) && !OPENAI_NON_CHAT_PATTERN.test(id);
}

function isFree(row) {
  if (String(row.id).endsWith(":free")) return true;
  const pricing = row.pricing || {};
  return pricing.prompt !== undefined && Number(pricing.prompt) === 0 && Number(pricing.completion) === 0;
}

export function normalizeModels(providerId, payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  const seen = new Set();
  return rows
    .filter((row) => row && typeof row.id === "string" && row.id.trim())
    .map((row) => ({
      id: row.id.trim(),
      name: String(row.name || row.id).trim(),
      free: providerId === "openrouter" && isFree(row),
      chat: isChatModel(providerId, row.id.trim()),
      contextLength: Number(row.context_length) || null,
    }))
    .filter((model) => {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function groupModels(providerId, models) {
  if (providerId === "openrouter") {
    const free = models.filter((model) => model.free);
    const paid = models.filter((model) => !model.free);
    return [
      { label: `Free models (${free.length})`, models: free },
      { label: `All other models (${paid.length})`, models: paid },
    ].filter((group) => group.models.length);
  }
  const chat = models.filter((model) => model.chat);
  const other = models.filter((model) => !model.chat);
  return [
    { label: `Chat models (${chat.length})`, models: chat },
    { label: `Other models (${other.length})`, models: other },
  ].filter((group) => group.models.length);
}

function toneFor(ageBand) {
  if (ageBand === "adult") return "clear, engaging, and informative for adults";
  if (ageBand === "early_elementary") return "simple, upbeat, and easy for young children";
  return "friendly, age-appropriate, and fun for children";
}

function lengthFor(mode) {
  if (mode === "quick") return "Keep it to 1-2 punchy sentences.";
  if (mode === "history") return "Keep narration to 2-5 concise sentences and lead with the most interesting historical fact.";
  return "Keep narration to 2-5 concise sentences.";
}

export function buildMessages({ fallbackScript = "", place = {}, summary = "", nearby = [], mode = "storyteller", ageBand = "adult" } = {}) {
  const system = [
    "You write short location-aware road trip narration that will be read aloud in a moving car.",
    "You will receive a Raw Extract field containing the encyclopedia summary for this place.",
    "Mine it aggressively for specific, concrete facts: population numbers, founding year, notable people, historical events,",
    "what the place is known for economically or culturally, nearby attractions, geographic features, and local trivia.",
    "If the raw extract contains detailed information, use it. Do not summarize vaguely.",
    "Lead with the most interesting, surprising, or specific fact first.",
    "If a fact is missing from the context, skip it entirely. Never invent details.",
    lengthFor(mode),
    `Use a tone that is ${toneFor(ageBand)}.`,
    "Output ONLY the narration text. No preamble, no headings, no bullet points, no quotation marks, no notes about your changes.",
  ].join(" ");
  const facts = {
    name: place.name || "",
    region: place.region || "",
    country: place.country || "",
    population: Number(place.population) > 0 ? Number(place.population) : null,
    nearby: (nearby || []).slice(0, 5).map((item) => ({ name: item.name, kind: item.kind || "" })),
    narrationMode: mode,
    audience: ageBand,
  };
  const user = [
    "Rewrite this road trip narration to highlight specific, concrete facts.",
    "Extract numbers, names, dates, and details from the Raw Extract. Do not simply paraphrase it; pick the most interesting specific facts.",
    "Skip any topic where data is missing and do not add filler.",
    "",
    "Fallback script:",
    fallbackScript,
    "",
    "Structured context JSON:",
    JSON.stringify(facts),
    ...(summary ? ["", "Raw Extract (mine this for specific facts):", String(summary).slice(0, 6000)] : []),
    "",
    "Output ONLY the rewritten narration.",
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export function cleanNarration(text) {
  let value = String(text || "").replace(/\r/g, "").trim();
  if (!value) return "";
  value = value.replace(/^\s*(?:sure|certainly|of course)[^\n]*\n+/i, "");
  value = value.replace(/^\s*(?:here(?:'s| is)|below is)[^\n:]*:\s*/i, "");
  value = value.replace(/\n+\s*(?:\*\*)?(?:key changes|changes made|notes?)(?:\*\*)?:?[\s\S]*$/i, "");
  value = value.replace(/\*\*/g, "").replace(/^#+\s*/gm, "");
  value = value.replace(/^\s*[-•]\s+/gm, "");
  value = value.replace(/\s+/g, " ").trim();
  const wrapped = (open, close) => value.length >= 2 && value.startsWith(open) && value.endsWith(close);
  if (wrapped('"', '"') || wrapped("“", "”") || wrapped("'", "'")) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function describeFailure(provider, status, payload) {
  const detail = payload?.error?.message || payload?.message || "";
  if (status === 401) return `${provider.name} rejected the API key.`;
  if (status === 402) return `${provider.name} reports insufficient credits on this key.`;
  if (status === 403) return `${provider.name} refused this request${detail ? `: ${detail}` : "."}`;
  if (status === 404) return `${provider.name} could not find that model.`;
  if (status === 429) return `${provider.name} is rate limiting requests. Try again shortly.`;
  return `${provider.name} returned ${status}${detail ? `: ${detail}` : "."}`;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
  return "";
}

export class NarrationClient {
  constructor(fetchImpl = globalThis.fetch) {
    this.fetch = typeof fetchImpl === "function" ? fetchImpl.bind(globalThis) : null;
  }

  async request(url, { provider, method = "GET", key = "", body = null, timeoutMs = MODELS_TIMEOUT_MS, responseType = "json" }) {
    if (!this.fetch) throw new Error("This browser cannot reach the network");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { Accept: responseType === "blob" ? "audio/mpeg, application/json" : "application/json" };
    if (key) headers.Authorization = `Bearer ${key}`;
    if (body) headers["Content-Type"] = "application/json";
    try {
      const response = await this.fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!response.ok) {
        const failure = new Error(describeFailure(provider, response.status, await readJson(response)));
        failure.status = response.status;
        throw failure;
      }
      return responseType === "blob" ? response.blob() : readJson(response);
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(`${provider.name} took too long to respond.`);
      if (error instanceof TypeError) {
        const failure = new Error(`Could not reach ${provider.name}. Check your connection.`);
        failure.code = "network";
        throw failure;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Some providers answer a bad key on POST endpoints from an edge layer that
   * omits CORS headers, so the browser only sees a network failure. The model
   * list endpoint does answer with readable errors, so use it to explain why
   * a request failed.
   */
  async verifyKey(providerId, key) {
    const provider = PROVIDERS[providerId];
    if (!provider) return { ok: false, message: "Choose an AI provider first." };
    try {
      await this.request(provider.modelsUrl, { provider, key });
      return { ok: true, message: `${provider.name} accepted the API key.` };
    } catch (error) {
      return { ok: false, message: error.message, status: error.status, code: error.code };
    }
  }

  async listModels(providerId, key) {
    const provider = PROVIDERS[providerId];
    if (!provider) throw new Error("Choose an AI provider first.");
    const payload = await this.request(provider.modelsUrl, { provider, key });
    const models = normalizeModels(providerId, payload);
    if (!models.length) throw new Error(`${provider.name} returned no models for this key.`);
    return models;
  }

  async narrate({ providerId, key, model, fallbackScript = "", context = {} }) {
    const provider = PROVIDERS[providerId];
    if (!provider) throw new Error("Choose an AI provider first.");
    if (!key) throw new Error(`Add your ${provider.name} API key in Settings.`);
    if (!model) throw new Error("Choose a model in Settings.");
    const body = { model, messages: buildMessages({ fallbackScript, ...context }) };
    if (providerId === "openai") body.max_completion_tokens = 400;
    else body.max_tokens = 400;
    const payload = await this.request(provider.chatUrl, {
      provider,
      method: "POST",
      key,
      body,
      timeoutMs: NARRATION_TIMEOUT_MS,
    });
    const text = cleanNarration(messageText(payload?.choices?.[0]?.message?.content));
    if (!text) throw new Error(`${provider.name} returned an empty story.`);
    return text;
  }
}

export class SpeechClient extends NarrationClient {
  async synthesize({ key, model = "gpt-4o-mini-tts", voice = "sage", text, instructions = "" }) {
    const provider = PROVIDERS.openai;
    if (!key) throw new Error("Add your OpenAI API key in Settings.");
    const input = String(text || "").replace(/\s+/g, " ").trim().slice(0, TTS_INPUT_LIMIT);
    if (!input) throw new Error("There is nothing to read aloud.");
    const body = { model, voice, input, response_format: "mp3" };
    if (instructions && isSteerableSpeechModel(model)) body.instructions = instructions;
    return this.request(provider.speechUrl, {
      provider,
      method: "POST",
      key,
      body,
      timeoutMs: SPEECH_TIMEOUT_MS,
      responseType: "blob",
    });
  }
}
