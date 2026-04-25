import { db, aiSettingsTable, type AiSettings } from "@workspace/db";
import { getAnthropic } from "@workspace/integrations-anthropic-ai";

export type AiProvider = "anthropic" | "openai" | "grok";

const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o-mini",
  grok: "grok-2-latest",
};

const DEFAULT_BASE_URLS: Record<AiProvider, string | null> = {
  anthropic: null,
  openai: "https://api.openai.com/v1",
  grok: "https://api.x.ai/v1",
};

function isProvider(s: string | null | undefined): s is AiProvider {
  return s === "anthropic" || s === "openai" || s === "grok";
}

export async function getAiSettings(): Promise<AiSettings | null> {
  try {
    const rows = await db.select().from(aiSettingsTable).limit(1);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export type AiCallOpts = {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
};

export type AiCallResult = {
  text: string;
  provider: AiProvider;
  model: string;
};

/**
 * Run a single text-generation call against the configured AI provider.
 * Falls back to the Replit Anthropic integration env vars when no key is
 * stored in the database for the anthropic provider.
 */
export async function aiGenerateText(opts: AiCallOpts): Promise<AiCallResult> {
  const settings = await getAiSettings();
  const provider: AiProvider = isProvider(settings?.provider) ? settings!.provider as AiProvider : "anthropic";
  const model = (settings?.model && settings.model.trim()) || DEFAULT_MODELS[provider];
  const baseUrl = (settings?.baseUrl && settings.baseUrl.trim()) || DEFAULT_BASE_URLS[provider];
  const apiKey = (settings?.apiKey && settings.apiKey.trim()) || null;
  const maxTokens = opts.maxTokens ?? 8192;

  if (provider === "anthropic") {
    const client = getAnthropic({ apiKey, baseURL: baseUrl });
    const message = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: opts.systemPrompt,
      messages: [{ role: "user", content: opts.userPrompt }],
    });
    const block = message.content[0];
    const text = block && block.type === "text" ? block.text : "";
    return { text, provider, model };
  }

  // OpenAI-compatible (OpenAI ChatGPT, xAI Grok)
  if (!apiKey) {
    throw new Error(`API key for provider "${provider}" is not configured. Add it in Admin Settings.`);
  }
  const url = `${baseUrl ?? DEFAULT_BASE_URLS[provider]}/chat/completions`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userPrompt },
      ],
    }),
  });
  if (!r.ok) {
    const errBody = await r.text().catch(() => "");
    throw new Error(`${provider} API ${r.status}: ${errBody.slice(0, 500)}`);
  }
  const j: any = await r.json();
  const text = j?.choices?.[0]?.message?.content ?? "";
  return { text: typeof text === "string" ? text : JSON.stringify(text), provider, model };
}

/**
 * Returns true when an Anthropic key is available via the Replit env vars,
 * meaning we can run AI calls without the user having to configure anything.
 */
export function hasReplitAnthropicEnv(): boolean {
  return Boolean(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY);
}
