# RoadTripper + Jev: integration analysis

**Status:** analysis only. No application code changed.
**Date:** 2026-09-19
**Subject:** TypeSafe AI's Jev model (`jev-1.13.0`, alias `jev-latest`) and where it fits in RoadTripper's narration pipeline.

Sources: the [TypeSafe launch post](https://typesafe.ai/blog/introducing-system-one-models-and-jev), the [live docs](https://docs.typesafe.ai/llms.txt) as read on 2026-09-19, and the RoadTripper code on `main` at commit `4db64d8`.

---

## 1. Summary

Jev is not a language model in the sense RoadTripper already uses one. It never writes text. You send it a `state` (a string, JSON object, or array) plus a set of typed questions, and it answers every question in parallel in roughly 100 to 500 ms. There are three question types: a yes/no probability (TypeSafe calls it a **Noul**), a **Choice** from a fixed list, and a **Score** on an ordered rubric you define. Choice and Score answers carry a full probability distribution and a confidence number. Input costs $0.042 per million tokens and output is free.

That shape matches the parts of RoadTripper that are currently hand-written heuristics, regexes, and pleading in a system prompt:

| Judgment RoadTripper makes today | Where | How it is done now | Jev fit |
| --- | --- | --- | --- |
| Is this place worth interrupting the car for? | `storyguide/relevance.py` `score_place` | Adds fixed points for each non-empty field | **High.** Replace the interestingness score. Keep cooldown and distance logic in code. |
| Which Wikipedia sentences are history, claim to fame, trivia, boilerplate? | `storyguide/providers.py` `LivePlaceProvider.enrich` | Regex on "founded/established" plus a year; first long fragment becomes `known_for` | **High.** One Choice per sentence, all in one call. |
| Did the Wikipedia lookup return the right article? | not checked | `"Name, Region"` then bare `Name` | **High.** One Noul catches disambiguation misses. |
| Is this fact suitable for a six-year-old? | `storyguide/narration.py` `SENSITIVE_WORDS` | Word substitution ("murder" becomes "hard history") | **High.** Score per sentence, drop instead of mangle. |
| Did the LLM invent a fact, add a preamble, or write for the wrong audience? | `storyguide/llm.py` `clean_narration` and the system prompt | Regex strips preambles; facts are not checked | **High.** A post-check with fallback to the built-in script. |
| Which route towns deserve advance research and an LLM story? | `storyguide/service.py` `run_plotted_route_research` | Population filter, then every town in order | **Medium.** Rank, then spend LLM calls on the top of the list. |
| Which nearby point of interest to mention? | `narration.py` uses `nearby[0]` | Closest by distance | **Medium.** One Choice over the candidates. |
| Is the driver far enough from the last story? | `relevance.py`, `docs/js/core.js` | Haversine and timers | **None.** Keep in code. Jev is bad at arithmetic. |
| Write the narration | `llm.py`, `docs/js/llm.js` | OpenRouter or OpenAI | **None.** Jev cannot generate text. |

**Recommendation.** Add a small, dependency-free judgment provider to the Python server, run it in shadow mode first (log what Jev would have decided, change nothing), then switch on the narration gate and the LLM output check. Fragment selection and route-town ranking follow. The browser edition waits on a CORS question that is unresolved as of this writing (see section 5.5).

---

## 2. Jev in one page

### The call

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <TYPESAFE_API_KEY>
Content-Type: application/json
```

```json
{
  "model": "jev-latest",
  "state": { "any": "JSON, string, or array of text" },
  "questions": {
    "is_urgent":  { "type": "noul",   "instructions": "Does this convey urgency?",
                    "criteria": { "true": "Explicitly time-sensitive", "false": "No urgency expressed" } },
    "department": { "type": "choice", "instructions": "Which team should handle this?",
                    "criteria": { "billing": "Payments, refunds", "technical": "Bugs, outages", "sales": null } },
    "frustration":{ "type": "score",  "instructions": "How frustrated is the customer?",
                    "criteria": ["Calm", "Frustrated but civil", "Very angry"] }
  }
}
```

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "is_urgent":   { "type": "noul",   "noul": 0.92 },
    "department":  { "type": "choice", "choice": "technical",
                     "probabilities": { "billing": 0.08, "technical": 0.85, "sales": 0.07 }, "confidence": 0.82 },
    "frustration": { "type": "score",  "score": 1.6, "legend": { "0": "Calm", "1": "Frustrated but civil", "2": "Very angry" },
                     "probabilities": { "0": 0.05, "1": 0.3, "2": 0.65 }, "confidence": 0.78 }
  },
  "usage": { "input_tokens": 312, "output_tokens": 48 }
}
```

Question IDs are for your code and are not shown to the model, so each `instructions` string must carry the full question. Instructions and criteria may be JSON objects or arrays, not just strings. Reference parts of a structured state with backticked paths such as `` `fragments[3]` ``.

### Facts that shape the design

| Item | Value | Source |
| --- | --- | --- |
| Current model | `jev-1.13.0`; `jev-latest` and `jev-preview` both point to it | docs.typesafe.ai/models |
| Price | $0.042 per million input tokens; output free | same |
| Rate limits | 250,000 tokens/s and 1,200 requests/min, "adjusting dynamically" | same |
| Context | 64k tokens per request; 32k for state plus the longest single question | same |
| Input | Text only; English is the primary training language | same |
| Latency | 70 to 500 ms end-to-end, vendor claim | launch post |
| Errors | 401 bad key, 422 malformed, 429 rate limit, 529 overloaded (also observed a 403 on an unauthenticated POST) | docs.typesafe.ai/api |
| Python SDK | `pip install typesafe-sdk` (Python 3.10+), `TypeSafeClient().system_one(state, questions)`, answers via `response.answers["id"]` or `response.nouls/choices/scores`, default timeout 10 s, env `TYPESAFE_API_KEY` | docs.typesafe.ai/sdk/python |
| JavaScript SDK | `npm install @typesafe-ai/sdk` (Node 20+), `client.systemOne({state, questions})`, helpers `noul()`, `choice()`, `score()` | docs.typesafe.ai/sdk/javascript |
| Data handling | Not trained on customer requests; zero-data-retention only on enterprise plans | docs.typesafe.ai/models |
| Determinism | "Extremely consistent" for identical input; alias can move to a new version, so pin `jev-1.13.0` once thresholds are tuned | models page and jaggedness page |

### What Jev is bad at (from TypeSafe's own jaggedness page for 1.13)

1. **Literal reading.** It answers the question as written, not as meant. Put boundary cases in the criteria.
2. **Math and counting.** Distances, populations thresholds, sentence counts, and "is X bigger than Y" belong in code.
3. **Dates.** Do not ask whether 1881 is before 1900. Extract the year by regex (RoadTripper already does) and compare in code.
4. **Indirection.** Multi-hop questions lose accuracy. Point at the field by name.
5. **Large irrelevant state.** Accuracy falls as unrelated content grows. Send only what the question needs.
6. **Adversarial text.** State is treated as data but can still steer answers. Wikipedia extracts are low risk; user-typed text is not.
7. **Contradictory instruction and criteria.** Keep them aligned; never make `true` mean "no".
8. **Structural invariants.** A Noul and a yes/no Choice on the same question do not return the same number. Do not carry a threshold from one to the other.
9. **Generation.** It cannot write. Bounded extraction works as a Choice over candidates found in code.

---

## 3. RoadTripper's pipeline today

The Python server path for a live GPS update, from `StoryGuideService.ingest_location` in `storyguide/service.py`:

```
POST /api/trips/{id}/locations
  → storage.add_location
  → provider.reverse_geocode        Nominatim, 3 s timeout
  → provider.enrich                 Wikipedia summary, 3 s timeout; regex splits extract into
                                    population / history / known_for / trivia
  → provider.nearby_places          Wikipedia geosearch, 3 s timeout
  → relevance.should_narrate        additive field score vs 0.35 threshold, then cooldown rules
  → narration_builder.build_current_place_script     template sentences + SENSITIVE_WORDS swap
  → _maybe_llm_narrate              OpenRouter or OpenAI rewrite, 10 s timeout, whole context JSON
                                    plus raw extract in the prompt; clean_narration regex on output
  → storage.add_event               narration_events.score = heuristic score
  → response.decision {should_narrate, score, reason}   shown on the UI decision line
```

Three details matter for the integration:

- **The Wikipedia extract is already in hand before the gate runs.** `enrich` happens before `should_narrate`, so a Jev call at the gate has the text it needs at no extra fetch cost.
- **The response already carries a `decision` object.** Jev's answers can ride along to the local UI without a new endpoint.
- **The server has no third-party Python dependencies** and calls every provider with `urllib.request`. The integration should do the same rather than add the SDK.

The browser edition in `docs/` has a thinner version: `shouldNarrate` in `docs/js/core.js` uses only time and distance (no interest score at all), `buildNarration` takes the first one or two sentences of the extract, and `writeWithModel` in `docs/js/app.js` calls the user's own OpenRouter or OpenAI key through `docs/js/llm.js`.

---

## 4. Integration points

Each subsection gives what happens today, the questions to ask, how code consumes the answers, and the fallback when Jev is unavailable. Every Jev call must be optional: a timeout or error returns `None` and the current heuristic runs unchanged.

### 4.1 The narration gate

**Today.** `RelevanceEngine.score_place` starts at 0.2 and adds 0.05 to 0.2 for each populated field. Any place with a Wikipedia extract long enough to fill `known_for` and `history` scores about 0.7, so on a live trip nearly every town that has an article clears the 0.35 threshold. The cooldown rules then do the real filtering, by distance from the last event, not by whether the town has anything to say.

**Proposed.** Run the cooldown and distance checks first, in code, exactly as now. Only if they pass, ask Jev one request about the place. Combine Jev's answers with the field-count heuristic as a composite score, and keep every threshold in one dict so tuning is a constant edit.

State, built from fields the service already has:

```json
{
  "place": { "name": "Temple", "region": "Texas", "country": "USA", "population": 82073 },
  "extract": "Temple is a city in Bell County, Texas, United States. As of 2020, the city has a population of 82,073 according to the U.S. census. Temple lies in the region referred to as Central Texas and is a principal city in the Killeen–Temple–Fort Hood metropolitan area, which as of the 2020 Census had a population of 475,367. Located off Interstate 35, Temple is 68 miles (109 km) north of Austin, 34 miles (55 km) south of Waco and 27 miles east of Killeen.",
  "fragments": [
    "Temple is a city in Bell County, Texas, United States.",
    "As of 2020, the city has a population of 82,073 according to the U.S. census.",
    "Temple lies in the region referred to as Central Texas and is a principal city in the Killeen–Temple–Fort Hood metropolitan area, which as of the 2020 Census had a population of 475,367.",
    "Located off Interstate 35, Temple is 68 miles (109 km) north of Austin, 34 miles (55 km) south of Waco and 27 miles east of Killeen."
  ],
  "nearby": [
    { "name": "Temple Railroad and Heritage Museum", "kind": "museum" },
    { "name": "Czech Heritage Museum", "kind": "museum" }
  ],
  "audience": "elementary",
  "mode": "storyteller"
}
```

That extract is the real Wikipedia REST summary for Temple, Texas as fetched on 2026-09-19, and it is a useful test case because it contains nothing but location and population. The expected answers are a high `extract_matches_place`, a low `worth_a_story`, an `interest` near level 0, and `angle` of `none`. Today's heuristic gives this place about 0.7 because the positional regex fills `known_for` and `history` with the Central Texas and Interstate 35 sentences, so the live edition narrates it.

Do not send GPS coordinates, the trip id, or the full `PlaceProfile.to_dict()`; none of it helps the questions and the jaggedness page says unrelated state costs accuracy.

Questions in the same request:

```json
{
  "extract_matches_place": {
    "type": "noul",
    "instructions": "Does `extract` describe the town or city named `place.name` in `place.region`, rather than a different place, building, ship, or person that shares the name?",
    "criteria": {
      "true": "The extract is about that municipality.",
      "false": "The extract is about something else with the same name, or is a disambiguation page."
    }
  },
  "worth_a_story": {
    "type": "noul",
    "instructions": "Would a curious passenger driving through want to hear a thirty-second story about `place`, based on `extract` and `nearby`?",
    "criteria": {
      "true": "There is at least one specific, memorable fact: an event, a person, an industry, a natural feature, or a claim to fame.",
      "false": "The extract only says what kind of place it is, where it is, and how many people live there."
    }
  },
  "interest": {
    "type": "score",
    "instructions": "How much would a passenger remember about `place` an hour after hearing a story built from `extract`?",
    "criteria": [
      "Nothing beyond its name: the extract has only location and population facts",
      "One mildly notable detail",
      "A specific story a passenger would repeat later",
      "A must-hear: a famous event, person, landmark, or claim to fame"
    ]
  },
  "angle": {
    "type": "choice",
    "instructions": "Which angle gives the best thirty-second story about `place` from `extract`?",
    "criteria": {
      "history": "A founding, a battle, a boom or bust, a disaster, a name origin",
      "people": "A notable person born, raised, or buried here",
      "nature": "A river, lake, mountain, cave, park, or unusual geography",
      "economy": "An industry, company, crop, or product the place is known for",
      "culture": "A festival, food, team, school, or tradition",
      "quirky": "A record, an oddity, or a piece of trivia",
      "none": "Nothing in the extract supports a story"
    }
  },
  "best_nearby": {
    "type": "choice",
    "instructions": "Which entry in `nearby` would a passenger most want pointed out from the road?",
    "criteria": {
      "Temple Railroad and Heritage Museum": "museum",
      "Czech Heritage Museum": "museum",
      "none": "None of them is worth a mention"
    }
  }
}
```

Composition in code, replacing the interior of `should_narrate` after the cooldown checks:

```python
THRESHOLDS = {
    "extract_mismatch_max": 0.6,   # above this the extract is about the wrong thing; treat place as fact-free
    "worth_min": 0.45,             # below this Jev says skip
    "interest_min": 1.0,           # score levels 0..3; 1.0 = "one mildly notable detail"
    "heuristic_weight": 0.4,
    "jev_weight": 0.6,
}

def blended_score(heuristic: float, judgment: Optional[PlaceJudgment]) -> tuple[float, str]:
    if judgment is None:
        return heuristic, "heuristic_only"
    if judgment.extract_matches_place < 1 - THRESHOLDS["extract_mismatch_max"]:
        return 0.2, "jev_extract_mismatch"          # fall back to name-and-population facts only
    interest = judgment.interest / 3.0             # normalise the 0..3 score to 0..1
    score = THRESHOLDS["heuristic_weight"] * heuristic + THRESHOLDS["jev_weight"] * interest
    if judgment.worth_a_story < THRESHOLDS["worth_min"] or judgment.interest < THRESHOLDS["interest_min"]:
        return score, "jev_not_worth_it"
    return score, "jev_worth_it"
```

The existing `reason` strings (`first_event`, `cooldown_distance`, and so on) stay. New reasons `jev_worth_it`, `jev_not_worth_it`, `jev_extract_mismatch`, and `heuristic_only` join them, and the UI decision line shows them as it does today.

**Why blend rather than replace.** The heuristic is free and deterministic, and it already encodes things Jev should not judge, such as whether the enrollment database had a row. The blend also means a Jev outage degrades to today's behavior instead of to silence.

**Fallback.** Any exception, timeout, or non-200 status returns `None` from the provider and the gate behaves exactly as it does on `main`.

### 4.2 Fragment selection: pick the facts instead of regexing for them

**Today.** `LivePlaceProvider.enrich` splits the extract on periods, skips "is a city in" boilerplate and population sentences, then takes the first sentence containing a founding verb and a year as `history`, the next fragment over 30 characters as `known_for`, and up to three more as `trivia`. `NarrationBuilder` then reads those fields positionally. The LLM prompt separately dumps the entire context JSON and the raw extract and asks the model to "mine it aggressively".

**Proposed.** Send the same `fragments` array (already computed by the split) and ask one Choice per fragment for its role, plus one Noul per fragment for whether it is memorable. All of it goes in the same request as the gate questions in 4.1, because they share the state. TypeSafe's fan-out pattern is explicit that extra questions add tokens but almost no latency.

```json
{
  "fragment_2_role": {
    "type": "choice",
    "instructions": "What kind of fact is `fragments[2]`?",
    "criteria": {
      "boilerplate": "Says what kind of place it is or where it is, with no other information",
      "population": "A census or population figure",
      "history": "Founding, naming, a historical event, or how the place changed over time",
      "person": "A notable person connected to the place",
      "economy": "An industry, employer, company, crop, or product",
      "geography": "A river, lake, landform, climate, or park",
      "culture": "A school, team, festival, food, or tradition",
      "other": "None of the above"
    }
  },
  "fragment_2_memorable": {
    "type": "noul",
    "instructions": "Would a passenger remember `fragments[2]` an hour after hearing it?",
    "criteria": {
      "true": "It names something specific and surprising, or gives a concrete number, date, or name tied to a story.",
      "false": "It is generic, administrative, or a restatement of the place's location."
    }
  }
}
```

Code then fills `PlaceProfile.history` with the fragment whose `history` probability is highest, `known_for` with the highest memorable fragment that is not boilerplate or population, and `trivia` with the next two or three memorable fragments. The regex path stays as the fallback and for extracts with no Jev answer.

The same selected fragments feed a much smaller LLM prompt. Instead of the whole context JSON plus the raw extract, `_build_prompt` sends the three or four chosen sentences and the `angle` from 4.1. That cuts the OpenRouter or OpenAI input by roughly half for a typical town, gives the writer less room to wander, and removes the need for the "mine it aggressively" instructions.

**Prerequisite: a sentence-aware splitter.** `enrich` splits on a bare period, so the real Temple extract above becomes six fragments, three of which are "according to the U", "S", and "census". The browser edition's `sentenceList` regex in `docs/js/core.js` breaks the same way on "U.S." Jev would judge those shards literally. A small splitter that survives common abbreviations (U.S., St., Mt., Dr., Ft.) should land before any per-fragment question does; it is a fix worth making even without Jev.

**Limits.** Keep fragments to about twelve. The Wikipedia REST summary is usually four to eight sentences, so this is rarely a constraint. Jev cannot count, so sentence limits stay in code.

### 4.3 Child-appropriate content without word swaps

**Today.** `sanitize_text` in `narration.py` replaces "murder" with "hard history", "crime" with "serious history", "violent" with "dramatic", and "tragedy" with "challenging moment". This produces sentences like "the town was the site of a hard history in 1912" and misses everything not on the four-word list.

**Proposed.** Add one Score per fragment, consumed only when `age_band` is not `adult` (a speculative question in TypeSafe's terms: asked every time, read only when relevant):

```json
{
  "fragment_2_kid_fit": {
    "type": "score",
    "instructions": "How suitable is `fragments[2]` to read aloud to a six-year-old passenger?",
    "criteria": [
      "Fine as written",
      "Mentions death, crime, disaster, or war in passing; fine with gentle wording",
      "Graphic, frightening, or adult subject matter; leave it out for young children"
    ]
  }
}
```

Code drops fragments at level 2 for `early_elementary` and `elementary`, and passes level-1 fragments through the existing `sanitize_text` swap. The same audience question runs on the final LLM script in 4.4. `SENSITIVE_WORDS` stays as the last line of defence.

### 4.4 Verifying the LLM's narration

**Today.** `_maybe_llm_narrate` takes whatever the model returns, runs `clean_narration` to strip "Here's a rewrite:" and "Key changes:" tails, and speaks it. Nothing checks whether the model invented a founding date, described a different town, or wrote for the wrong audience. The system prompt spends four sentences begging the model not to mislabel district enrollment as high-school enrollment.

**Proposed.** After the LLM returns and `clean_narration` runs, one Jev request with the facts and the script in the state. This follows TypeSafe's citation-check and guardrails cookbooks.

State:

```json
{
  "facts": {
    "place": { "name": "Temple", "region": "Texas", "population": 82073, "high_school_enrollment": null },
    "fragments": [
      "Temple lies in the region referred to as Central Texas and is a principal city in the Killeen–Temple–Fort Hood metropolitan area, which as of the 2020 Census had a population of 475,367.",
      "Located off Interstate 35, Temple is 68 miles (109 km) north of Austin, 34 miles (55 km) south of Waco and 27 miles east of Killeen."
    ]
  },
  "script": "Temple grew up around the Santa Fe railroad in 1881 and is now the heart of a metro area of nearly half a million people, about an hour north of Austin on Interstate 35."
}
```

The script is the kind of thing a writer model produces when told to "mine aggressively": the railroad and 1881 are true of Temple but appear nowhere in the facts it was given. `unsupported_fact` should come back high, and the policy below sends the built-in script instead.

Questions:

```json
{
  "unsupported_fact": {
    "type": "noul",
    "instructions": "Does `script` state a specific number, date, name, or event that does not appear anywhere in `facts`?",
    "criteria": {
      "true": "At least one concrete detail in the script is absent from the facts.",
      "false": "Every concrete detail in the script can be found in the facts, allowing for rewording."
    }
  },
  "wrong_place": {
    "type": "noul",
    "instructions": "Does `script` describe a place other than `facts.place.name`, `facts.place.region`?"
  },
  "has_meta_text": {
    "type": "noul",
    "instructions": "Does `script` contain anything that is not narration meant to be read aloud in a car, such as a preamble, notes about edits, headings, bullet points, or quotation marks around the whole text?"
  },
  "audience_fit": {
    "type": "score",
    "instructions": "How suitable is `script` to read aloud to a six-year-old passenger?",
    "criteria": [
      "Fine as written",
      "Mentions death, crime, disaster, or war in passing",
      "Graphic, frightening, or adult subject matter"
    ]
  },
  "enrollment_mislabel": {
    "type": "noul",
    "instructions": "Does `script` describe a number as high school enrollment when `facts` gives it as district-wide or K-12 enrollment, or when `facts.place.high_school_enrollment` is null?"
  }
}
```

Policy in code:

```python
VERIFY = {"unsupported_max": 0.7, "wrong_place_max": 0.5, "meta_max": 0.7, "kid_score_max": 1.5}

def accept_script(script: str, verdict: Optional[ScriptJudgment], age_band: str) -> tuple[str, str]:
    if verdict is None:
        return script, "unverified"
    if verdict.wrong_place > VERIFY["wrong_place_max"]:
        return "", "rejected_wrong_place"
    if verdict.unsupported_fact > VERIFY["unsupported_max"]:
        return "", "rejected_unsupported_fact"
    if verdict.has_meta_text > VERIFY["meta_max"]:
        script = clean_narration(script)            # already ran once; a second pass is cheap
    if age_band != "adult" and verdict.audience_fit > VERIFY["kid_score_max"]:
        return "", "rejected_audience"
    return script, "verified"
```

An empty result falls back to the built-in script, which is what happens today when the LLM call fails. The verdict string is stored with the event (section 5.3) so the history view can show "verified" or the rejection reason.

**Why this is worth a second network call.** The LLM call already costs 2 to 10 s and real money. Adding roughly 300 ms and a hundredth of a cent to catch a fabricated date before it is spoken to a child is a good trade, and the check is the only thing in the pipeline that can catch a wrong-town narration.

### 4.5 Plot Trip: rank towns before spending LLM calls

**Today.** `create_plotted_route` collects every gazetteer town above `min_population` within the corridor, and `run_plotted_route_research` researches them sequentially, calling the LLM for each one. A long route can mean dozens of LLM calls for towns whose only fact is a census figure. The browser edition does the same for the first 18 towns with three workers.

**Proposed.** Split research into two passes. Pass one fetches the Wikipedia summary for every town (cheap, already cached in the browser edition). Pass two runs the 4.1 gate questions per town. Then sort by `interest`, and only towns above `interest_min` get the LLM rewrite; the rest keep the built-in script and are marked with a `quick` tag. This is TypeSafe's re-ranking pattern: a cheap filter (population) followed by one judgment per candidate.

Because each town is a separate state, this is one Jev request per town rather than one request with many questions. At typical extract sizes that is about a thousand tokens each, so a forty-town route costs under a cent and finishes in a few seconds if the calls are issued concurrently with a small thread pool. The existing `threading.Thread` research job is the natural home.

### 4.6 Which nearby point to mention

**Today.** `build_current_place_script` names `nearby[0]`, the closest Wikipedia geosearch hit, which is often a school, a creek, or a cell tower article. The browser edition names the two closest Overpass results.

**Proposed.** The `best_nearby` Choice in 4.1 already covers this. Its criteria are built from the candidate names with the `kind` as the description, plus `none`. Code uses the choice when its confidence is above about 0.5 and otherwise keeps the closest, so a flat distribution (nothing stands out) behaves as today.

### 4.7 Selected-point blurbs

`narrate_selected_place` builds a script from an OSM tag blurb that is frequently "A nearby point of interest discovered on the map." One Noul, "Does `blurb` say anything beyond naming the place and its type?", lets code skip an empty blurb and lean on the Wikipedia extract instead. Small win, trivial to add once the provider exists.

### 4.8 What stays in code

Distance, bearing, cooldown timers, population thresholds, the "one story every N km" rule, sentence and word limits, text-to-speech, and the narration itself. Jev is a judgment engine and every one of these is either arithmetic or generation.

---

## 5. Architecture

### 5.1 A judgment provider, in the style of `llm.py`

New module `storyguide/judgment.py`:

```python
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Dict, Optional


class BaseJudgmentProvider:
    provider_name = "none"

    def ask(self, state, questions: Dict, timeout: float = 2.5) -> Optional[Dict]:
        return None


class NoOpJudgmentProvider(BaseJudgmentProvider):
    pass


class TypeSafeJudgmentProvider(BaseJudgmentProvider):
    provider_name = "typesafe"
    url = "https://api.typesafe.ai/v1/systemone"

    def __init__(self, api_key: str, model: str = "jev-1.13.0"):
        self.api_key = api_key
        self.model = model

    def ask(self, state, questions: Dict, timeout: float = 2.5) -> Optional[Dict]:
        payload = json.dumps({"model": self.model, "state": state, "questions": questions}).encode("utf-8")
        request = urllib.request.Request(
            self.url,
            data=payload,
            headers={"Content-Type": "application/json", "Authorization": "Bearer %s" % self.api_key},
        )
        for attempt in range(2):
            try:
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    body = json.loads(response.read().decode("utf-8"))
                return body.get("answers")
            except urllib.error.HTTPError as exc:
                if exc.code in (429, 529) and attempt == 0:
                    time.sleep(0.4)
                    continue
                return None
            except (urllib.error.URLError, TimeoutError, ValueError):
                return None
        return None


def build_judgment_provider_from_env(env: Optional[Dict[str, str]] = None) -> BaseJudgmentProvider:
    env = env or os.environ
    if env.get("ROADTRIPPER_JUDGMENT_PROVIDER", "").strip().lower() != "typesafe":
        return NoOpJudgmentProvider()
    api_key = (env.get("ROADTRIPPER_TYPESAFE_API_KEY") or env.get("TYPESAFE_API_KEY") or "").strip()
    if not api_key:
        return NoOpJudgmentProvider()
    return TypeSafeJudgmentProvider(api_key=api_key, model=env.get("ROADTRIPPER_TYPESAFE_MODEL", "jev-1.13.0"))
```

Question builders (`place_questions(fragments, nearby)`, `script_questions()`) and answer parsers into small dataclasses (`PlaceJudgment`, `ScriptJudgment`) live in the same module, so `relevance.py`, `providers.py`, and `llm.py` never see raw JSON.

The vendor SDK is a fine alternative if the no-dependency rule is ever relaxed. It adds retries with `retry-after` handling and typed responses, and reads `TYPESAFE_API_KEY` from the environment. The local machine runs Python 3.14 and the SDK needs 3.10 or newer.

### 5.2 Wiring

- `StoryGuideService.__init__` gains `judgment_provider: Optional[BaseJudgmentProvider] = None`, built from the environment like `llm_provider`, and passes it to `RelevanceEngine`, `LivePlaceProvider`, and the verify step.
- `RelevanceEngine.should_narrate` reorders to run cooldown checks first, then calls the provider once, then blends. It returns the same `(bool, score, reason)` tuple, so `service.py` and the tests keep their shape.
- `LivePlaceProvider.enrich` accepts the fragment answers when present and otherwise runs the regex path.
- `_maybe_llm_narrate` runs the verify request when a provider exists and returns the fallback script on rejection.
- `.env.example` gains three lines:

```
# Optional Jev judgment layer (TypeSafe). Gates narration, picks facts, checks LLM output.
# ROADTRIPPER_JUDGMENT_PROVIDER=typesafe
# ROADTRIPPER_TYPESAFE_API_KEY=your_typesafe_key_here
# ROADTRIPPER_TYPESAFE_MODEL=jev-1.13.0
```

`storyguide/config.py` already loads `.env` from the working directory, and the launchd plist sets `WorkingDirectory` to the deployed checkout, so the key reaches the background server without a plist change. `.env` is gitignored.

### 5.3 Storage

Two additions to `storyguide/storage.py`, both guarded so existing databases upgrade in place:

1. `narration_events.judgments_json TEXT NULL`: the raw answers from both Jev calls plus the `model` string the API reported and the verify verdict. Storing the raw probabilities rather than the derived decision is deliberate. TypeSafe's composite-scoring guidance is that thresholds and weights can be re-tuned later without re-running inference as long as the raw judgments were kept.
2. A `place_decisions` table (`trip_id, place_name, region, heuristic_score, blended_score, judgments_json, should_narrate, reason, recorded_at`) written for every gate evaluation, including the ones that decided not to narrate. Without this there is no record of what Jev suppressed, which is exactly the data needed to tune the gate.

### 5.4 API and UI

No new endpoints. `ingest_location` already returns `decision`; add a `judgment` sub-object with `worth_a_story`, `interest`, `angle`, and `reason`, and let the local UI's decision line render "Jev: 0.82 worth a story, angle history". Add a trip setting `story_filter` with values `strict`, `normal`, `everything` that maps to three threshold sets in code. `everything` disables the Jev gate but keeps verification.

### 5.5 Browser edition

The Pages edition would benefit from the same gate and verification, and the questions are plain JSON that can live in one shared file (`storyguide/data/jev_questions.json`, copied into `docs/js/` at publish time) so the two editions never drift. The client would be a third bring-your-own-key provider in `docs/js/llm.js` using the existing `NarrationClient.request` helper, with `https://api.typesafe.ai` added to the `connect-src` list in the Content-Security-Policy in `docs/index.html`.

**Blocker.** A CORS preflight sent on 2026-09-19 from the `https://jsherman999.github.io` origin to `https://api.typesafe.ai/v1/systemone` returned `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers` but no `Access-Control-Allow-Origin`, and the preflight itself answered 400. A browser will refuse the call under those conditions. Either TypeSafe allowlists origins per account, or the endpoint is not meant for direct browser use. Confirm with TypeSafe before building this; the alternative is a tiny proxy, which the Pages edition has so far avoided on purpose. The JavaScript SDK is documented for Node 20 and its constructor throws on an unsupported runtime, so the raw `fetch` path is the right one regardless.

### 5.6 iOS

The SwiftUI scaffold has its own `RoadTripperLLM.swift` with Keychain-backed keys. A Jev client there is a single `URLSession` POST and the same shared question JSON. It is the last phase because the Python server is where the trip logic actually lives today.

---

## 6. Cost and latency

Token estimates for a typical town (2,500-character extract, eight fragments, four nearby candidates):

| Call | State tokens | Question tokens | Total | Cost at $0.042 per Mtok |
| --- | --- | --- | --- | --- |
| Gate plus fragments (4.1 to 4.3, one request) | ~700 | ~1,800 (about 25 questions) | ~2,500 | $0.0001 |
| Verify (4.4) | ~500 | ~350 | ~850 | $0.00004 |
| Per narrated place | | | | ~$0.00015 |

A six-hour drive that narrates sixty places costs about a cent. Calling the gate on every GPS ping instead of only after the cooldown passes would be roughly fifteen cents. Rate limits (1,200 requests per minute) are irrelevant for one car and comfortable for a forty-town route research job.

Latency budget for a live update on the Python server today: up to 3 s each for Nominatim, Wikipedia, and geosearch, then up to 10 s for the LLM. Jev's stated 70 to 500 ms fits inside that with a 2.5 s timeout and no retry on timeout. The verify call adds the same again after the LLM. Neither is on the path for places the cooldown already suppressed, which is most GPS pings.

---

## 7. Rollout plan

**Phase 0, one afternoon.** Get an API key from the TypeSafe console. The checkout in `cc_projects` has an almost empty database, but the deployed copy that launchd runs from `/Users/jay/opencode/roadtripper` holds real history: 23 trips, 262 narration events, and 183 researched route towns whose `research_json` includes the place's `raw_extract`. Pull ten of those extracts, paste them into the playground with the 4.1 questions, and adjust wording until the answers match your own judgment. This is where "literal reading" bites, and it is cheaper to find out in the playground than in a moving car.

**Phase 1, shadow mode.** Add `judgment.py`, the `place_decisions` table, and the gate call, but keep `should_narrate` returning the heuristic decision. Log both. Add `scripts/replay_judgments.py` that takes a database path, walks every `route_towns.research_json` row (which stores the full place profile and the narration that was produced) and every `narration_events` row, rebuilds the state, and prints what Jev would have decided next to what the heuristic did decide. Point it at the deployed database first. Then drive with shadow mode on for a week.

**Phase 2, gate on.** Flip the blend on behind `story_filter`. Add the `best_nearby` choice. Update the three relevance tests in `tests/test_phase2_enrichment.py` to inject a fake provider.

**Phase 3, facts.** Fragment roles and kid-fit in `enrich`, the slimmed LLM prompt. Compare narration length and LLM token usage before and after.

**Phase 4, verify.** The post-LLM check with fallback. Watch the rejection rate; if `unsupported_fact` fires on more than a few percent of good scripts, loosen the criteria wording before loosening the threshold.

**Phase 5, Plot Trip.** Two-pass research with ranking and an LLM budget per route.

**Phase 6, other clients.** Browser edition once CORS is settled; iOS after that.

Pin `ROADTRIPPER_TYPESAFE_MODEL` to `jev-1.13.0` from phase 1. Thresholds tuned against one version are not guaranteed to hold when the alias moves.

---

## 8. Testing

- **Unit tests** use a `FakeJudgmentProvider` whose `ask` returns canned answer dicts, mirroring the `FakeLLMProvider` pattern already in `tests/test_phase6_reliability.py`. Test the pure policy functions (`blended_score`, `accept_script`, fragment selection) directly with hand-written answer dicts; they need no network.
- **Fallback tests** assert that a provider returning `None`, raising, or timing out leaves every result identical to `main` today. This is the property that makes the feature safe to ship.
- **Recorded fixtures.** Save a handful of real responses as JSON under `tests/fixtures/jev/` and replay them, the way TypeSafe's cookbooks ship a `json_cache.json`. One optional live test runs only when `ROADTRIPPER_TYPESAFE_API_KEY` is set.
- **Offline evaluation.** Label thirty of the 262 past narrations in the deployed database as keep or skip, run the replay script, and report agreement and the two error types. Tune thresholds on that set, not on intuition. Re-run it whenever question wording or the pinned model changes.
- **Browser tests** in `tests/browser_llm.test.mjs` cover the question builder and policy once the shared JSON exists, using the node test runner already in place.

The current suite (33 Python tests) passes on `main`; it should still pass with the provider defaulting to no-op.

---

## 9. Risks and how each maps to RoadTripper

| Risk | Where RoadTripper would hit it | Mitigation |
| --- | --- | --- |
| Literal reading | "Is this interesting?" is vague; Jev answers whatever the criteria say | Criteria name concrete signals (event, person, industry, number). Playground pass in phase 0. |
| No counting or math | Sentence limits, population cut-offs, distance | Keep all of it in code; never ask Jev to compare numbers. |
| Dates | "Founded before 1900" style questions | Regex extracts the year today; compare in code. |
| Context rot | Sending `PlaceProfile.to_dict()` plus the whole context JSON | State carries only the extract, fragments, four place fields, and nearby names. |
| Adversarial text | Wikipedia is benign; OSM `description` tags and typed blurbs are user-generated | Only extracts and blurbs from the fetched sources go in; never the trip name or free text from the UI. |
| Alias drift | Thresholds tuned on 1.13 silently applied to 1.14 | Pin the version; log `model` from every response into `judgments_json`. |
| Rate limits "adjusting dynamically" | Research job on a long route | Concurrency of three or four, honour 429 with backoff, and the job already tolerates per-town failure. |
| Vendor benchmarks | The 40x to 200x speed claims come from TypeSafe's own harness | Measure on your own data in phase 1. The design does not depend on the multipliers being true. |
| Privacy | Place names, Wikipedia text, and audience setting leave the machine | No coordinates, trip names, or history are sent. TypeSafe states it does not train on requests; zero retention is enterprise-only. Document this in the README alongside the existing key-handling notes. |
| Offline driving | Same as Wikipedia and the LLM today | Every call is optional with a short timeout and a code fallback. |
| Non-English places | Trips outside the US | Jev's accuracy is lower outside English; the fallback path covers it. |

---

## 10. Open questions for TypeSafe

1. Does `api.typesafe.ai` support direct browser calls with an allowlisted origin, or is a server-side proxy expected? (Section 5.5.)
2. Is there a per-key or per-organization way to pin a model version so `jev-latest` never moves under a deployed key?
3. Any guidance on maximum useful fragment count for per-item questions before accuracy drops, given the 64k budget?
4. Is the playground share link a stable way to keep the question set reviewable outside the repo?

---

## 11. Appendix: the full gate request, ready for the playground

```json
{
  "model": "jev-1.13.0",
  "state": {
    "place": { "name": "Temple", "region": "Texas", "country": "USA", "population": 82073 },
    "extract": "Temple is a city in Bell County, Texas, United States. As of 2020, the city has a population of 82,073 according to the U.S. census. Temple lies in the region referred to as Central Texas and is a principal city in the Killeen–Temple–Fort Hood metropolitan area, which as of the 2020 Census had a population of 475,367. Located off Interstate 35, Temple is 68 miles (109 km) north of Austin, 34 miles (55 km) south of Waco and 27 miles east of Killeen.",
    "fragments": [
      "Temple is a city in Bell County, Texas, United States.",
      "As of 2020, the city has a population of 82,073 according to the U.S. census.",
      "Temple lies in the region referred to as Central Texas and is a principal city in the Killeen–Temple–Fort Hood metropolitan area, which as of the 2020 Census had a population of 475,367.",
      "Located off Interstate 35, Temple is 68 miles (109 km) north of Austin, 34 miles (55 km) south of Waco and 27 miles east of Killeen."
    ],
    "nearby": [
      { "name": "Temple Railroad and Heritage Museum", "kind": "museum" },
      { "name": "Czech Heritage Museum", "kind": "museum" }
    ],
    "audience": "elementary",
    "mode": "storyteller"
  },
  "questions": {
    "extract_matches_place": {
      "type": "noul",
      "instructions": "Does `extract` describe the town or city named `place.name` in `place.region`, rather than a different place, building, ship, or person that shares the name?",
      "criteria": { "true": "The extract is about that municipality.", "false": "The extract is about something else with the same name, or is a disambiguation page." }
    },
    "worth_a_story": {
      "type": "noul",
      "instructions": "Would a curious passenger driving through want to hear a thirty-second story about `place`, based on `extract` and `nearby`?",
      "criteria": { "true": "There is at least one specific, memorable fact: an event, a person, an industry, a natural feature, or a claim to fame.", "false": "The extract only says what kind of place it is, where it is, and how many people live there." }
    },
    "interest": {
      "type": "score",
      "instructions": "How much would a passenger remember about `place` an hour after hearing a story built from `extract`?",
      "criteria": [
        "Nothing beyond its name: the extract has only location and population facts",
        "One mildly notable detail",
        "A specific story a passenger would repeat later",
        "A must-hear: a famous event, person, landmark, or claim to fame"
      ]
    },
    "angle": {
      "type": "choice",
      "instructions": "Which angle gives the best thirty-second story about `place` from `extract`?",
      "criteria": {
        "history": "A founding, a battle, a boom or bust, a disaster, a name origin",
        "people": "A notable person born, raised, or buried here",
        "nature": "A river, lake, mountain, cave, park, or unusual geography",
        "economy": "An industry, company, crop, or product the place is known for",
        "culture": "A festival, food, team, school, or tradition",
        "quirky": "A record, an oddity, or a piece of trivia",
        "none": "Nothing in the extract supports a story"
      }
    },
    "best_nearby": {
      "type": "choice",
      "instructions": "Which entry in `nearby` would a passenger most want pointed out from the road?",
      "criteria": { "Temple Railroad and Heritage Museum": "museum", "Czech Heritage Museum": "museum", "none": "None of them is worth a mention" }
    },
    "fragment_3_role": {
      "type": "choice",
      "instructions": "What kind of fact is `fragments[3]`?",
      "criteria": {
        "boilerplate": "Says what kind of place it is or where it is, with no other information",
        "population": "A census or population figure",
        "history": "Founding, naming, a historical event, or how the place changed over time",
        "person": "A notable person connected to the place",
        "economy": "An industry, employer, company, crop, or product",
        "geography": "A river, lake, landform, climate, or park",
        "culture": "A school, team, festival, food, or tradition",
        "other": "None of the above"
      }
    },
    "fragment_3_memorable": {
      "type": "noul",
      "instructions": "Would a passenger remember `fragments[3]` an hour after hearing it?",
      "criteria": { "true": "It names something specific and surprising, or gives a concrete number, date, or name tied to a story.", "false": "It is generic, administrative, or a restatement of the place's location." }
    },
    "fragment_3_kid_fit": {
      "type": "score",
      "instructions": "How suitable is `fragments[3]` to read aloud to a six-year-old passenger?",
      "criteria": [
        "Fine as written",
        "Mentions death, crime, disaster, or war in passing; fine with gentle wording",
        "Graphic, frightening, or adult subject matter; leave it out for young children"
      ]
    }
  }
}
```

The real request repeats the three `fragment_N_*` questions for every index; only index 3 is shown here to keep the appendix readable. For this extract the useful playground check is that `worth_a_story` is low, `interest` sits near level 0, `angle` is `none`, and `fragment_3_role` is `boilerplate` or `geography` rather than `history`. Then swap in the extract for a town with a real story, such as Waco or Georgetown from the demo catalog in `storyguide/providers.py`, and confirm the answers move.

---

## 12. References

- Launch post: https://typesafe.ai/blog/introducing-system-one-models-and-jev
- Docs index: https://docs.typesafe.ai/llms.txt
- API reference: https://docs.typesafe.ai/api
- Models, pricing, limits: https://docs.typesafe.ai/models
- Jev 1.13 jaggedness: https://docs.typesafe.ai/model-jaggedness/jev-1.13
- Patterns used here: speculative fan-out, composite scoring, confidence-gated routing (https://docs.typesafe.ai/patterns)
- Cookbooks used here: re-ranking, double-checking citations, guardrails for LLMs, classifying RAG passages (https://docs.typesafe.ai/cookbooks)
- RoadTripper code touched by this plan: `storyguide/relevance.py`, `storyguide/providers.py`, `storyguide/narration.py`, `storyguide/llm.py`, `storyguide/service.py`, `storyguide/storage.py`, `docs/js/core.js`, `docs/js/llm.js`, `docs/js/app.js`, `docs/index.html`
