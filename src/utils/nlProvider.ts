/**
 * nlProvider.ts — Provider-agnostic NL Keyword Suggestion engine
 *
 * Supported providers:
 *   anthropic  — Claude Haiku / Sonnet via Anthropic SDK
 *   openai     — GPT-4o / GPT-4o-mini via OpenAI API
 *   groq       — Llama / Mixtral / Gemma via Groq API (OpenAI-compatible)
 *   ollama     — Any local model via Ollama REST API
 *   compatible — Any OpenAI-compatible endpoint (Azure OpenAI, Together.ai, Mistral, etc.)
 */

export type NlProviderType = 'anthropic' | 'openai' | 'groq' | 'gemini' | 'ollama' | 'compatible';

export interface NlProviderConfig {
  provider:    NlProviderType;
  apiKey?:     string;   // Anthropic / OpenAI / Groq / compatible
  model?:      string;   // model name / tag
  baseUrl?:    string;   // Ollama or compatible endpoint base URL
}

export interface NlSuggestion {
  keyword:     string | null;
  locatorName: string | null;
  value:       string | null;
  confidence:  number;         // 0–1
  provider:    string;         // which provider answered
}

// ── Prompt builder (shared across all providers) ─────────────────────────────

export function buildNlPrompt(
  description: string,
  kwList:      string,
  locList:     string,
): string {
  return `You are a test automation assistant. Map the tester's plain-English description to a Playwright keyword test step.

## Available Keywords
${kwList}

## Available Locator Names for this project
${locList}

## Instructions
Return a JSON object with EXACTLY these fields:
- "keyword": one keyword key from the list above (e.g. "CLICK", "FILL", "ASSERT TEXT")
- "locatorName": best matching locator name from the list, or null if none fits
- "value": value to use (text to type, text to assert, URL, etc.), or null
- "confidence": number 0–1 (your confidence in the mapping)

Return ONLY valid JSON. No explanation, no markdown, no code fences.

## Tester's Description
${description.trim()}`;
}

function parseResponse(raw: string, provider: string): NlSuggestion {
  const text = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/,'');
  const json = JSON.parse(text);
  return {
    keyword:     json.keyword     || null,
    locatorName: json.locatorName || null,
    value:       json.value       || null,
    confidence:  typeof json.confidence === 'number' ? json.confidence : 1,
    provider,
  };
}

// ── Provider implementations ──────────────────────────────────────────────────

async function callAnthropic(cfg: NlProviderConfig, prompt: string): Promise<NlSuggestion> {
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic.default({ apiKey: cfg.apiKey });
  const model     = cfg.model || 'claude-haiku-4-5-20251001';
  const msg = await client.messages.create({
    model,
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });
  const raw = (msg.content[0] as any)?.text?.trim() || '{}';
  return parseResponse(raw, `anthropic/${model}`);
}

async function callOpenAICompat(
  cfg:      NlProviderConfig,
  prompt:   string,
  provider: string,
): Promise<NlSuggestion> {
  const baseUrl = (cfg.baseUrl || 'https://api.openai.com').replace(/\/$/, '');
  const model   = cfg.model || 'gpt-4o-mini';
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${cfg.apiKey || ''}`,
    },
    body: JSON.stringify({
      model,
      max_tokens:  256,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${provider} API error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json() as any;
  const raw  = data.choices?.[0]?.message?.content?.trim() || '{}';
  return parseResponse(raw, `${provider}/${model}`);
}

async function callGemini(cfg: NlProviderConfig, prompt: string): Promise<NlSuggestion> {
  const model  = cfg.model || 'gemini-1.5-flash';
  const apiKey = cfg.apiKey || '';
  const url    = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json() as any;
  const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';
  return parseResponse(raw, `gemini/${model}`);
}

async function callOllama(cfg: NlProviderConfig, prompt: string): Promise<NlSuggestion> {
  const baseUrl = (cfg.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
  const model   = cfg.model || 'qwen2.5:0.5b';
  const res = await fetch(`${baseUrl}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream:   false,
      options:  { temperature: 0.1, num_predict: 256 },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json() as any;
  const raw  = data.message?.content?.trim() || '{}';
  return parseResponse(raw, `ollama/${model}`);
}

// ── Public factory function ───────────────────────────────────────────────────

export async function nlSuggest(
  cfg:         NlProviderConfig,
  description: string,
  kwList:      string,
  locList:     string,
): Promise<NlSuggestion> {
  const prompt = buildNlPrompt(description, kwList, locList);

  switch (cfg.provider) {
    case 'anthropic':
      return callAnthropic(cfg, prompt);

    case 'openai':
      return callOpenAICompat(
        { ...cfg, baseUrl: 'https://api.openai.com', model: cfg.model || 'gpt-4o-mini' },
        prompt, 'openai',
      );

    case 'groq':
      return callOpenAICompat(
        { ...cfg, baseUrl: 'https://api.groq.com/openai', model: cfg.model || 'llama-3.1-8b-instant' },
        prompt, 'groq',
      );

    case 'ollama':
      return callOllama(cfg, prompt);

    case 'gemini' as any:
      return callGemini(cfg, prompt);

    case 'compatible':
      if (!cfg.baseUrl) throw new Error('baseUrl is required for compatible provider');
      return callOpenAICompat(cfg, prompt, 'compatible');

    default:
      throw new Error(`Unknown NL provider: ${(cfg as any).provider}`);
  }
}

// ── Provider metadata (used by Admin UI) ─────────────────────────────────────

export const NL_PROVIDERS: Array<{
  id:          NlProviderType;
  label:       string;
  needsKey:    boolean;
  needsUrl:    boolean;
  defaultModel:string;
  modelOptions: Array<{ value: string; label: string }>;
  keyPlaceholder: string;
  urlPlaceholder: string;
  helpText:    string;
}> = [
  {
    id: 'anthropic', label: 'Anthropic (Claude)', needsKey: true, needsUrl: false,
    defaultModel: 'claude-haiku-4-5-20251001',
    modelOptions: [
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fastest, cheapest ~$0.0003/req)' },
      { value: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6 (more accurate)' },
    ],
    keyPlaceholder: 'sk-ant-…',
    urlPlaceholder: '',
    helpText: 'Get your API key from console.anthropic.com. Billed per token, separate from Pro subscription.',
  },
  {
    id: 'openai', label: 'OpenAI (GPT)', needsKey: true, needsUrl: false,
    defaultModel: 'gpt-4o-mini',
    modelOptions: [
      { value: 'gpt-4o-mini', label: 'GPT-4o mini (cheap, fast)' },
      { value: 'gpt-4o',      label: 'GPT-4o (most accurate)' },
    ],
    keyPlaceholder: 'sk-…',
    urlPlaceholder: '',
    helpText: 'Get your API key from platform.openai.com.',
  },
  {
    id: 'groq', label: 'Groq (Free tier available)', needsKey: true, needsUrl: false,
    defaultModel: 'llama-3.1-8b-instant',
    modelOptions: [
      { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant (free tier)' },
      { value: 'llama3-70b-8192',      label: 'Llama 3 70B (higher quality)' },
      { value: 'mixtral-8x7b-32768',   label: 'Mixtral 8x7B' },
      { value: 'gemma2-9b-it',         label: 'Gemma 2 9B' },
    ],
    keyPlaceholder: 'gsk_…',
    urlPlaceholder: '',
    helpText: 'Free tier: 14,400 req/day at console.groq.com. Rate limits may apply during peak hours.',
  },
  {
    id: 'gemini' as any, label: 'Google Gemini (Free tier available)', needsKey: true, needsUrl: false,
    defaultModel: 'gemini-1.5-flash',
    modelOptions: [
      { value: 'gemini-1.5-flash',   label: 'Gemini 1.5 Flash (free tier: 15 req/min, 1M tokens/day)' },
      { value: 'gemini-1.5-pro',     label: 'Gemini 1.5 Pro (higher quality, lower free limits)' },
      { value: 'gemini-2.0-flash',   label: 'Gemini 2.0 Flash (latest, fast)' },
    ],
    keyPlaceholder: 'AIza…',
    urlPlaceholder: '',
    helpText: 'Get free API key from aistudio.google.com. Free tier: 15 req/min, 1M tokens/day. No credit card needed.',
  },
  {
    id: 'ollama', label: 'Ollama (Local / Air-gapped)', needsKey: false, needsUrl: true,
    defaultModel: 'qwen2.5:0.5b',
    modelOptions: [
      { value: 'qwen2.5:0.5b',   label: 'Qwen 2.5 0.5B (~400MB RAM) — recommended for servers' },
      { value: 'smollm2:135m',   label: 'SmolLM2 135M (~270MB RAM) — ultra-light' },
      { value: 'llama3.2:1b',    label: 'Llama 3.2 1B (~1.3GB RAM)' },
      { value: 'llama3.2:3b',    label: 'Llama 3.2 3B (~4GB RAM)' },
      { value: 'mistral:7b',     label: 'Mistral 7B (~8GB RAM)' },
    ],
    keyPlaceholder: '',
    urlPlaceholder: 'http://localhost:11434',
    helpText: 'Run models locally. Install from ollama.com. No data leaves your server. Pull model first: ollama pull qwen2.5:0.5b',
  },
  {
    id: 'compatible', label: 'OpenAI-Compatible (Azure, Together, Mistral…)', needsKey: true, needsUrl: true,
    defaultModel: '',
    modelOptions: [],
    keyPlaceholder: 'your-api-key',
    urlPlaceholder: 'https://your-endpoint.openai.azure.com',
    helpText: 'Any provider with an OpenAI-compatible /v1/chat/completions endpoint. Enter the base URL and model name.',
  },
];
