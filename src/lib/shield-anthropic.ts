import Anthropic from "@anthropic-ai/sdk";

/**
 * The only place /api/shield constructs an Anthropic client.
 * The AI-off path returns before this is called.
 */
export const shieldAnthropic = {
  create(apiKey: string) {
    return new Anthropic({ apiKey });
  },
};
