/**
 * Short, human-readable display names for Ollama model tags.
 *
 * The chat header shows the model at all times, so it needs a name that fits in
 * a narrow panel: `thiagomoraes/medgemma-1.5-4b-it:Q4_K_M` is not something a
 * radiologist should have to read to know which model is answering.
 *
 * This is a DISPLAY concern only. The full tag is always kept verbatim in the
 * model dropdown and, more importantly, in every message's
 * `PromptContextSnapshot` — provenance must record exactly what ran, including
 * the quantization, because `…:Q4_K_M` and `…:F16` are different models for
 * audit purposes even though they share a display name.
 */

/**
 * Canonical casing for model families, which cannot be derived mechanically
 * ("medgemma" → "MedGemma", not "Medgemma"). Keys are lowercase; anything absent
 * falls back to simple capitalization, so an unknown family degrades to
 * "Newmodel" rather than being dropped.
 */
const FAMILY_CASING: Record<string, string> = {
  medgemma: 'MedGemma',
  gemma: 'Gemma',
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
  qwen: 'Qwen',
  llama: 'Llama',
  llava: 'LLaVA',
  mistral: 'Mistral',
  mixtral: 'Mixtral',
  phi: 'Phi',
  gpt: 'GPT',
  oss: 'OSS',
  moondream: 'Moondream',
  granite: 'Granite',
  internvl: 'InternVL',
  pixtral: 'Pixtral',
  kimi: 'Kimi',
  glm: 'GLM',
};

/**
 * Parameter-count tokens (`4b`, `31b`, `671b`, `270m`). Dropped because the
 * header has no room for them and they do not help a clinician choose.
 */
const PARAM_COUNT_RE = /^\d+(?:\.\d+)?[bm]$/i;

/** Quantization tokens (`q4_k_m`, `Q8_0`, `fp16`, `bf16`). */
const QUANT_RE = /^(?:q\d.*|fp\d+|bf\d+|f\d+)$/i;

/** Variant suffixes that say "instruction-tuned chat model" — i.e. all of them. */
const VARIANT_RE = /^(?:it|instruct|chat|base|latest|cloud|text|vision|preview|thinking)$/i;

/** Whether a token carries no information worth showing in a narrow header. */
function isNoiseToken(token: string): boolean {
  return PARAM_COUNT_RE.test(token) || QUANT_RE.test(token) || VARIANT_RE.test(token);
}

/**
 * Split a run-together family and version (`gemma4` → `gemma`, `4`;
 * `MedGemma1.5` → `MedGemma`, `1.5`). Returns the token unchanged when it is not
 * of that shape, so `m3` and `v3.1` are left alone.
 */
function splitFamilyAndVersion(token: string): string[] {
  const m = /^([a-z]{3,})(\d+(?:\.\d+)*)$/i.exec(token);
  return m ? [m[1], m[2]] : [token];
}

/** Apply known family casing, else capitalize the first letter. */
function prettifyToken(token: string): string {
  const known = FAMILY_CASING[token.toLowerCase()];
  if (known) {
    return known;
  }
  // A leading digit means this is a version ("1.5", "3.1") — nothing to case.
  if (/^\d/.test(token)) {
    return token;
  }
  return token.charAt(0).toUpperCase() + token.slice(1);
}

/** Longest label the header will render before eliding. */
const MAX_LABEL_LEN = 22;

/**
 * Condense a model tag to a short display name.
 *
 * `gemma4:31b`                             → `Gemma 4`
 * `minimax-m3`                             → `MiniMax M3`
 * `thiagomoraes/medgemma-1.5-4b-it:Q4_K_M` → `MedGemma 1.5`
 * `MedAIBase/MedGemma1.5:4b`               → `MedGemma 1.5`
 * `deepseek-v3.1:671b`                     → `DeepSeek V3.1`
 *
 * Returns '' for an empty/absent tag so callers can fall back to their own
 * placeholder. Never throws: an unrecognized tag degrades to a capitalized
 * version of itself rather than to nothing, because a wrong-looking model name
 * is far less harmful than a header that silently shows no model at all.
 */
export function shortModelLabel(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') {
    return '';
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }

  // Strip the publisher namespace and the tag: `ns/name:tag` → `name`.
  const withoutNamespace = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  const withoutTag = withoutNamespace.split(':')[0];

  // Split on separators only — NOT on '.', which would break the version in
  // `medgemma-1.5` into `1` and `5`.
  const tokens = withoutTag.split(/[-_\s]+/).filter(Boolean);
  if (tokens.length === 0) {
    return trimmed.slice(0, MAX_LABEL_LEN);
  }

  // Only the first token can be a run-together family+version; a later `m3` or
  // `v3.1` is already a single meaningful token.
  const expanded = tokens.flatMap((token, i) => (i === 0 ? splitFamilyAndVersion(token) : [token]));

  // A quantization suffix is `_`-separated (`q4_k_m`), so tokenizing scatters it
  // into `q4`, `k`, `m` — and the orphan letters are not noise by any rule of
  // their own. Quantization is always terminal in an Ollama tag, so everything
  // from the first quant token onward is dropped as one unit.
  const quantAt = expanded.findIndex(t => QUANT_RE.test(t));
  const beforeQuant = quantAt === -1 ? expanded : expanded.slice(0, quantAt);

  const meaningful = beforeQuant.filter(t => !isNoiseToken(t));
  // Every token was noise (e.g. the tag was just `latest`) — showing the raw
  // tokens beats showing nothing. Falls back to the pre-quant tokens, never to
  // the scattered quant fragments.
  const fallback = beforeQuant.length > 0 ? beforeQuant : expanded;
  const kept = (meaningful.length > 0 ? meaningful : fallback).slice(0, 3);

  const label = kept.map(prettifyToken).join(' ');
  if (!label) {
    return trimmed.slice(0, MAX_LABEL_LEN);
  }
  return label.length > MAX_LABEL_LEN ? `${label.slice(0, MAX_LABEL_LEN - 1)}…` : label;
}
