import Anthropic from "@anthropic-ai/sdk";

export type AnthropicConfig = {
  apiKey?: string | null;
  baseURL?: string | null;
};

export function getAnthropic(cfg: AnthropicConfig = {}): Anthropic {
  const apiKey = cfg.apiKey || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  const baseURL = cfg.baseURL || process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  if (!apiKey) {
    throw new Error(
      "Anthropic API key is missing. Set one in Admin Settings or provision the Replit Anthropic AI integration.",
    );
  }
  return new Anthropic({ apiKey, baseURL: baseURL || undefined });
}

export const anthropic: Anthropic = new Proxy({} as Anthropic, {
  get(_target, prop) {
    const real = getAnthropic();
    const value = (real as any)[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});
