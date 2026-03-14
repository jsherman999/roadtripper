import base64
import json
import os
import urllib.error
import urllib.request
from typing import Dict, List, Optional, Tuple


OPENAI_TTS_VOICES = [
    "alloy",
    "ash",
    "ballad",
    "coral",
    "echo",
    "fable",
    "nova",
    "onyx",
    "sage",
    "shimmer",
]


class BaseTTSProvider:
    provider_name = "browser"

    def synthesize(self, text: str, voice: str = "") -> Optional[Tuple[bytes, str, str]]:
        return None

    def list_voices(self) -> List[Dict]:
        return []


class NoOpTTSProvider(BaseTTSProvider):
    pass


class OpenAITTSProvider(BaseTTSProvider):
    provider_name = "openai"

    def __init__(self, api_key: str, model: str = "tts-1-hd", default_voice: str = "sage"):
        self.api_key = api_key
        self.model = model
        self.default_voice = default_voice if default_voice in OPENAI_TTS_VOICES else "sage"

    def synthesize(self, text: str, voice: str = "") -> Optional[Tuple[bytes, str, str]]:
        selected_voice = voice if voice in OPENAI_TTS_VOICES else self.default_voice
        payload = {
            "model": self.model,
            "input": text,
            "voice": selected_voice,
            "response_format": "mp3",
        }
        request = urllib.request.Request(
            "https://api.openai.com/v1/audio/speech",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer %s" % self.api_key,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                audio = response.read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError):
            return None
        return audio, "audio/mpeg", selected_voice

    def list_voices(self) -> List[Dict]:
        return [{"id": voice, "name": voice.title()} for voice in OPENAI_TTS_VOICES]


def build_tts_provider_from_env(env: Optional[Dict[str, str]] = None) -> BaseTTSProvider:
    env = env or os.environ
    provider = env.get("ROADTRIPPER_TTS_PROVIDER", "").strip().lower()
    if provider == "openai":
        api_key = env.get("ROADTRIPPER_OPENAI_API_KEY", "").strip()
        model = env.get("ROADTRIPPER_TTS_MODEL", "tts-1-hd").strip() or "tts-1-hd"
        voice = env.get("ROADTRIPPER_TTS_VOICE", "sage").strip() or "sage"
        if api_key:
            return OpenAITTSProvider(api_key=api_key, model=model, default_voice=voice)
    return NoOpTTSProvider()


def audio_json_payload(audio: bytes, mime_type: str, voice: str, provider: str) -> Dict:
    return {
        "provider": provider,
        "mime_type": mime_type,
        "voice": voice,
        "audio_base64": base64.b64encode(audio).decode("ascii"),
    }
