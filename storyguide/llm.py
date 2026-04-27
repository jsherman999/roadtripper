import json
import os
import urllib.error
import urllib.request
from typing import Dict, List, Optional


class BaseNarrationLLM:
    provider_name = "none"

    def generate_narration(self, fallback_script: str, context: Dict, model_override: str = "") -> Optional[str]:
        return None

    def list_free_models(self) -> List[Dict]:
        return []


class NoOpNarrationLLM(BaseNarrationLLM):
    pass


class OpenRouterNarrationLLM(BaseNarrationLLM):
    provider_name = "openrouter"

    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model

    def generate_narration(self, fallback_script: str, context: Dict, model_override: str = "") -> Optional[str]:
        prompt = _build_prompt(fallback_script, context)
        payload = {
            "model": model_override or self.model,
            "messages": [
                {"role": "system", "content": _system_prompt(context)},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.5,
        }
        request = urllib.request.Request(
            "https://openrouter.ai/api/v1/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer %s" % self.api_key,
                "HTTP-Referer": "http://127.0.0.1:8000",
                "X-Title": "RoadTripper",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                body = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError):
            return None
        choices = body.get("choices", [])
        if not choices:
            return None
        content = choices[0].get("message", {}).get("content")
        return content.strip() if content else None

    def list_free_models(self) -> List[Dict]:
        request = urllib.request.Request(
            "https://openrouter.ai/api/v1/models",
            headers={"HTTP-Referer": "http://127.0.0.1:8000", "X-Title": "RoadTripper"},
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                body = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError):
            return [{"id": "openrouter/free", "name": "OpenRouter Free"}]
        models = [{"id": "openrouter/free", "name": "OpenRouter Free"}]
        for item in body.get("data", []):
            pricing = item.get("pricing") or {}
            try:
                prompt = float(pricing.get("prompt", "1"))
                completion = float(pricing.get("completion", "1"))
                request_cost = float(pricing.get("request", "0"))
            except (TypeError, ValueError):
                continue
            model_id = item.get("id", "")
            if (prompt == 0 and completion == 0 and request_cost == 0) or model_id.endswith(":free"):
                models.append({"id": model_id, "name": item.get("name", model_id)})
        unique = []
        seen = set()
        for model in models:
            if model["id"] in seen:
                continue
            seen.add(model["id"])
            unique.append(model)
        return unique


class OpenAINarrationLLM(BaseNarrationLLM):
    provider_name = "openai"

    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model

    def generate_narration(self, fallback_script: str, context: Dict, model_override: str = "") -> Optional[str]:
        payload = {
            "model": model_override or self.model,
            "input": [
                {"role": "system", "content": [{"type": "input_text", "text": _system_prompt(context)}]},
                {"role": "user", "content": [{"type": "input_text", "text": _build_prompt(fallback_script, context)}]},
            ],
            "temperature": 0.5,
        }
        request = urllib.request.Request(
            "https://api.openai.com/v1/responses",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer %s" % self.api_key,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                body = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError):
            return None
        output_text = body.get("output_text")
        if output_text:
            return output_text.strip()
        for item in body.get("output", []):
            for content in item.get("content", []):
                if content.get("type") == "output_text" and content.get("text"):
                    return content["text"].strip()
        return None


def build_llm_provider_from_env(env: Optional[Dict[str, str]] = None) -> BaseNarrationLLM:
    env = env or os.environ
    provider = env.get("ROADTRIPPER_LLM_PROVIDER", "").strip().lower()
    if provider == "openrouter":
        api_key = env.get("ROADTRIPPER_OPENROUTER_API_KEY", "").strip()
        model = env.get("ROADTRIPPER_LLM_MODEL", "openai/gpt-4.1-mini")
        if api_key:
            return OpenRouterNarrationLLM(api_key=api_key, model=model)
    if provider == "openai":
        api_key = env.get("ROADTRIPPER_OPENAI_API_KEY", "").strip()
        model = env.get("ROADTRIPPER_LLM_MODEL", "gpt-4.1-mini")
        if api_key:
            return OpenAINarrationLLM(api_key=api_key, model=model)
    return NoOpNarrationLLM()


def _system_prompt(context: Dict) -> str:
    audience = context.get("age_band", "elementary")
    if audience == "adult":
        tone = "clear, engaging, and informative for adults"
    elif audience == "early_elementary":
        tone = "simple, upbeat, and easy for young children"
    else:
        tone = "friendly, age-appropriate, and fun for children"
    return (
        "You write short location-aware road trip narration. "
        "You will receive a Raw Wikipedia Extract field containing the full Wikipedia summary for this place. "
        "Mine it aggressively for specific, concrete facts. "
        "Prioritize: population numbers, founding year, notable people born here, "
        "historical events, what the town is known for economically or culturally, "
        "nearby attractions, geographic features, and local trivia. "
        "If the raw extract contains detailed information, use it — do not summarize vaguely. "
        "Lead with the most interesting, surprising, or specific fact first. "
        "If a field in the structured context is null or empty, skip it entirely — do not invent or generalize. "
        "Keep narration to 2-5 concise sentences. "
        "Use a tone that is %s." % tone
    )


def _build_prompt(fallback_script: str, context: Dict) -> str:
    place = context.get("place", {})
    raw = place.get("raw_extract", "") if place else ""
    if not raw:
        kind = context.get("kind", "")
        if kind == "selected_point":
            raw = context.get("blurb", "")
        elif kind == "current_place":
            for p in [context.get("place", {})]:
                raw = p.get("raw_extract", "")
    if raw:
        raw_section = "\n\nRaw Wikipedia Extract (mine this for specific facts):\n%s" % raw
    else:
        raw_section = ""
    return (
        "Rewrite this road trip narration to highlight specific, concrete facts. "
        "Extract numbers, names, dates, and specific details from the Raw Wikipedia Extract provided. "
        "Do NOT just paraphrase the raw text — pick the most interesting specific facts. "
        "Skip any topic where data is missing. "
        "Do not add filler like \"a small town with its own character\" when you have no facts.\n\n"
        "Fallback script:\n%s\n\n"
        "Structured Context JSON:\n%s%s\n" % (fallback_script, json.dumps(context, sort_keys=True), raw_section)
    )
