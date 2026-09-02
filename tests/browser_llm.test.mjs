import test from "node:test";
import assert from "node:assert/strict";

import {
  KeyVault,
  NarrationClient,
  PROVIDERS,
  buildMessages,
  cleanNarration,
  groupModels,
  normalizeModels,
} from "../docs/js/llm.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    size: () => values.size,
  };
}

test("KeyVault keeps keys in the session unless asked to remember them", () => {
  const session = memoryStorage();
  const local = memoryStorage();
  const vault = new KeyVault({ session, local });

  vault.write("openrouter", "sk-or-session");
  assert.deepEqual(vault.read("openrouter"), { key: "sk-or-session", remembered: false });
  assert.equal(local.size(), 0);

  vault.write("openrouter", "sk-or-kept", { remember: true });
  assert.deepEqual(vault.read("openrouter"), { key: "sk-or-kept", remembered: true });
  assert.equal(session.size(), 0);

  vault.write("openrouter", "   ", { remember: true });
  assert.equal(vault.read("openrouter").key, "");
  assert.equal(local.size(), 0);
});

test("KeyVault falls back to memory when browser storage is unavailable", () => {
  const throwing = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() {},
  };
  const vault = new KeyVault({ session: throwing, local: throwing });
  vault.write("openai", "sk-memory");
  assert.equal(vault.read("openai").key, "sk-memory");
});

test("OpenRouter models are normalized, de-duplicated, sorted, and grouped by price", () => {
  const models = normalizeModels("openrouter", {
    data: [
      { id: "z/paid", name: "Zed Paid", pricing: { prompt: "0.001", completion: "0.002" } },
      { id: "a/free:free", name: "Alpha Free", pricing: { prompt: "0", completion: "0" } },
      { id: "a/free:free", name: "Duplicate" },
      { id: "m/zero", name: "Mid Zero", pricing: { prompt: "0", completion: "0" } },
      { id: "   ", name: "Blank id" },
    ],
  });
  assert.deepEqual(models.map((model) => model.id), ["a/free:free", "m/zero", "z/paid"]);
  const groups = groupModels("openrouter", models);
  assert.match(groups[0].label, /^Free models/);
  assert.equal(groups[0].models.length, 2);
  assert.deepEqual(groups[1].models.map((model) => model.id), ["z/paid"]);
});

test("OpenAI models separate chat models from other endpoints", () => {
  const models = normalizeModels("openai", {
    data: [{ id: "gpt-5-mini" }, { id: "whisper-1" }, { id: "text-embedding-3-small" }, { id: "gpt-4o-mini-tts" }, { id: "o4-mini" }],
  });
  const groups = groupModels("openai", models);
  assert.deepEqual(groups[0].models.map((model) => model.id), ["gpt-5-mini", "o4-mini"]);
  assert.deepEqual(groups[1].models.map((model) => model.id).sort(), ["gpt-4o-mini-tts", "text-embedding-3-small", "whisper-1"]);
});

test("cleanNarration strips preambles, markdown, trailing notes, and wrapping quotes", () => {
  const raw = 'Here is the rewritten narration:\n\n"**Duluth** sits on Lake Superior. It ships iron ore."\n\n**Key changes:**\n- Added facts';
  assert.equal(cleanNarration(raw), "Duluth sits on Lake Superior. It ships iron ore.");
  assert.equal(cleanNarration(""), "");
  assert.equal(cleanNarration("  Plain story.  "), "Plain story.");
});

test("buildMessages carries the fallback, facts, and raw extract to the model", () => {
  const messages = buildMessages({
    fallbackScript: "We are near Duluth.",
    place: { name: "Duluth", region: "Minnesota", population: 86697 },
    summary: "Duluth is a port city.",
    nearby: [{ name: "Aerial Lift Bridge", kind: "attraction" }],
    mode: "quick",
    ageBand: "early_elementary",
  });
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /young children/);
  assert.match(messages[0].content, /1-2/);
  assert.equal(messages[1].role, "user");
  assert.match(messages[1].content, /We are near Duluth\./);
  assert.match(messages[1].content, /Aerial Lift Bridge/);
  assert.match(messages[1].content, /86697/);
  assert.match(messages[1].content, /Duluth is a port city\./);
});

test("NarrationClient lists models with the key and explains rejected keys", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, status: 200, json: async () => ({ data: [{ id: "gpt-5-mini" }] }) };
  };
  const client = new NarrationClient(fetchImpl);
  const models = await client.listModels("openai", "sk-test");
  assert.equal(models[0].id, "gpt-5-mini");
  assert.equal(calls[0].url, PROVIDERS.openai.modelsUrl);
  assert.equal(calls[0].options.headers.Authorization, "Bearer sk-test");

  const rejecting = new NarrationClient(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "bad key" } }) }));
  await assert.rejects(rejecting.listModels("openrouter", "sk-or-bad"), /OpenRouter rejected the API key/);
  await assert.rejects(rejecting.listModels("nope", "x"), /Choose an AI provider/);
});

test("NarrationClient narrates through chat completions and cleans the reply", async () => {
  let sent = null;
  const fetchImpl = async (url, options) => {
    sent = { url: String(url), body: JSON.parse(options.body), headers: options.headers };
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "Here's your story:\n\n**Waco** was founded in 1849." } }] }),
    };
  };
  const client = new NarrationClient(fetchImpl);
  const story = await client.narrate({
    providerId: "openai",
    key: "sk-test",
    model: "gpt-5-mini",
    fallbackScript: "We are near Waco.",
    context: { place: { name: "Waco", region: "Texas" }, summary: "Waco was founded in 1849." },
  });
  assert.equal(story, "Waco was founded in 1849.");
  assert.equal(sent.url, PROVIDERS.openai.chatUrl);
  assert.equal(sent.body.model, "gpt-5-mini");
  assert.equal(sent.body.max_completion_tokens, 400);
  assert.equal(sent.body.max_tokens, undefined);
  assert.equal(sent.headers["Content-Type"], "application/json");
  assert.match(sent.body.messages[1].content, /We are near Waco\./);

  const openrouter = new NarrationClient(async (url, options) => {
    sent = { body: JSON.parse(options.body) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: [{ type: "text", text: "Array reply." }] } }] }) };
  });
  const arrayStory = await openrouter.narrate({ providerId: "openrouter", key: "sk-or-test", model: "x/y", fallbackScript: "f" });
  assert.equal(arrayStory, "Array reply.");
  assert.equal(sent.body.max_tokens, 400);
});

test("speech voices follow the model and instructions follow the audience", async () => {
  const { TTS_MODELS, TTS_VOICES, voicesForModel, speechInstructions } = await import("../docs/js/llm.js");
  assert.equal(TTS_MODELS[0].id, "gpt-4o-mini-tts");
  assert.ok(TTS_VOICES.some((voice) => voice.id === "sage"));
  assert.ok(voicesForModel("gpt-4o-mini-tts").some((voice) => voice.id === "marin"));
  assert.ok(!voicesForModel("tts-1").some((voice) => voice.id === "marin"));
  assert.ok(voicesForModel("tts-1").some((voice) => voice.id === "sage"));
  assert.match(speechInstructions("early_elementary", "storyteller"), /young children/);
  assert.match(speechInstructions("adult", "quick"), /brisk/);
});

test("SpeechClient posts to the speech endpoint, steers only steerable models, and returns audio", async () => {
  const { SpeechClient } = await import("../docs/js/llm.js");
  const sent = [];
  const fetchImpl = async (url, options) => {
    sent.push({ url: String(url), body: JSON.parse(options.body), headers: options.headers });
    return { ok: true, status: 200, blob: async () => new Blob(["audio-bytes"], { type: "audio/mpeg" }) };
  };
  const client = new SpeechClient(fetchImpl);
  const blob = await client.synthesize({ key: "sk-test", model: "gpt-4o-mini-tts", voice: "sage", text: "  We are near   Waco.  ", instructions: "warm" });
  assert.equal(blob.type, "audio/mpeg");
  assert.equal(sent[0].url, PROVIDERS.openai.speechUrl);
  assert.equal(sent[0].headers.Authorization, "Bearer sk-test");
  assert.deepEqual(sent[0].body, { model: "gpt-4o-mini-tts", voice: "sage", input: "We are near Waco.", response_format: "mp3", instructions: "warm" });

  await client.synthesize({ key: "sk-test", model: "tts-1", voice: "nova", text: "Hello", instructions: "warm" });
  assert.equal(sent[1].body.instructions, undefined);

  await assert.rejects(client.synthesize({ key: "", model: "tts-1", voice: "nova", text: "Hello" }), /OpenAI API key/);
  const rejecting = new SpeechClient(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "bad" } }) }));
  await assert.rejects(rejecting.synthesize({ key: "sk-bad", text: "Hello" }), /OpenAI rejected the API key/);
});

test("network failures are tagged and verifyKey explains them through the models endpoint", async () => {
  const failing = new NarrationClient(async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(failing.narrate({ providerId: "openai", key: "sk-x", model: "gpt-5-mini", fallbackScript: "f" }), (error) => error.code === "network");

  const verifier = new NarrationClient(async (url) => (
    String(url) === PROVIDERS.openai.modelsUrl
      ? { ok: false, status: 401, json: async () => ({ error: { message: "bad" } }) }
      : { ok: true, status: 200, json: async () => ({}) }
  ));
  const verdict = await verifier.verifyKey("openai", "sk-bad");
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, 401);
  assert.match(verdict.message, /rejected the API key/);

  const accepting = new NarrationClient(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }));
  assert.equal((await accepting.verifyKey("openai", "sk-good")).ok, true);
  assert.equal((await accepting.verifyKey("nope", "sk-good")).ok, false);
});
