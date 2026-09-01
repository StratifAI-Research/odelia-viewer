import { shortModelLabel } from './modelLabel';

describe('shortModelLabel', () => {
  it('condenses the tags actually deployed in this stack', () => {
    // The two models this platform ships/tests with, verbatim from .env and the
    // settings placeholder.
    expect(shortModelLabel('thiagomoraes/medgemma-1.5-4b-it:Q4_K_M')).toBe('MedGemma 1.5');
    expect(shortModelLabel('MedAIBase/MedGemma1.5:4b')).toBe('MedGemma 1.5');
  });

  it('condenses the cloud tags the user has access to', () => {
    expect(shortModelLabel('gemma4:31b')).toBe('Gemma 4');
    expect(shortModelLabel('minimax-m3')).toBe('MiniMax M3');
  });

  it('splits a run-together family and version', () => {
    expect(shortModelLabel('gemma4')).toBe('Gemma 4');
    expect(shortModelLabel('qwen3.5')).toBe('Qwen 3.5');
    // Version dots must survive: splitting on '.' would yield "MedGemma 1 5".
    expect(shortModelLabel('medgemma1.5')).toBe('MedGemma 1.5');
  });

  it('keeps a separate version token as-is rather than re-splitting it', () => {
    expect(shortModelLabel('deepseek-v3.1:671b')).toBe('DeepSeek V3.1');
    // `m3` is a variant name, not a parameter count — must not be dropped.
    expect(shortModelLabel('minimax-m3:latest')).toBe('MiniMax M3');
  });

  it('strips the publisher namespace and the tag', () => {
    expect(shortModelLabel('someuser/llama3.2:11b')).toBe('Llama 3.2');
    // A namespace containing a dash must not leak into the label.
    expect(shortModelLabel('my-org/phi4')).toBe('Phi 4');
  });

  it('drops parameter counts, quantizations and variant suffixes', () => {
    expect(shortModelLabel('gemma-3-27b-it')).toBe('Gemma 3');
    expect(shortModelLabel('llama-3.1-8b-instruct-q4_k_m')).toBe('Llama 3.1');
    expect(shortModelLabel('mistral-7b-fp16')).toBe('Mistral');
    expect(shortModelLabel('qwen-2.5-270m-base')).toBe('Qwen 2.5');
  });

  it('applies canonical family casing that capitalization alone cannot produce', () => {
    expect(shortModelLabel('deepseek-r1')).toBe('DeepSeek R1');
    expect(shortModelLabel('llava:13b')).toBe('LLaVA');
    expect(shortModelLabel('glm-4')).toBe('GLM 4');
    expect(shortModelLabel('gpt-oss:120b')).toBe('GPT OSS');
  });

  it('falls back to capitalization for an unknown family instead of dropping it', () => {
    // A model released after this code was written must still show *something*
    // recognizable in the header.
    expect(shortModelLabel('newmodel-2:9b')).toBe('Newmodel 2');
  });

  it('returns the raw tokens when every token is noise', () => {
    // `latest` is a variant suffix, but it is all we have — a blank header would
    // be worse than an imperfect one.
    expect(shortModelLabel('latest')).toBe('Latest');
    expect(shortModelLabel('ns/it:q4_0')).toBe('It');
  });

  it('returns an empty string for an absent tag so callers can use a placeholder', () => {
    expect(shortModelLabel('')).toBe('');
    expect(shortModelLabel('   ')).toBe('');
    expect(shortModelLabel(undefined)).toBe('');
    expect(shortModelLabel(null)).toBe('');
    // Defends against a non-string sneaking through an `any`-typed config read.
    expect(shortModelLabel(42 as unknown as string)).toBe('');
  });

  it('elides a label too long for the header', () => {
    const label = shortModelLabel('averyverylongfamilynameindeed-v2');
    expect(label.length).toBeLessThanOrEqual(22);
    expect(label.endsWith('…')).toBe(true);
  });

  it('caps how many tokens it keeps so a verbose tag cannot flood the header', () => {
    expect(shortModelLabel('alpha-beta-gamma-delta-epsilon')).toBe('Alpha Beta Gamma');
  });
});
