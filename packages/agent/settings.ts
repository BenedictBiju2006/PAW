import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { checked, ServiceError } from "../core/services";
import {
  encryptCredential,
  decryptCredential,
  credentialKey,
} from "./credentials";
export function supportedModels(env: NodeJS.ProcessEnv = process.env) {
  return (env.PAW_OPENAI_MODELS || "gpt-4.1-mini,gpt-4.1")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[a-zA-Z0-9._-]{1,100}$/.test(s))
    .slice(0, 20);
}
export class ProviderSettingsService {
  constructor(
    private admin: SupabaseClient,
    private actor: string,
    private env: NodeJS.ProcessEnv = process.env,
    private request: typeof fetch = fetch,
  ) {
    z.uuid().parse(actor);
  }
  async read() {
    const row = checked(
      await this.admin
        .from("provider_settings")
        .select("*")
        .eq("user_id", this.actor)
        .maybeSingle(),
    );
    return row;
  }
  async status() {
    const row = await this.read();
    let encryptionReady = true;
    try {
      credentialKey(this.env);
    } catch {
      encryptionReady = false;
    }
    const turns =
      checked(
        await this.admin
          .from("agent_turns")
          .select("input_tokens,output_tokens")
          .eq("user_id", this.actor)
          .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString())
          .limit(10000),
      ) ?? [];
    const usage = turns.reduce(
      (n, t) => ({
        input: n.input + t.input_tokens,
        output: n.output + t.output_tokens,
      }),
      { input: 0, output: 0 },
    );
    return {
      configured: !!row,
      encryptionReady,
      provider: "openai",
      model: row?.model ?? supportedModels(this.env)[0],
      models: supportedModels(this.env),
      tokenWarning: row?.token_warning ?? 100000,
      usage: {
        ...usage,
        cost: null,
        period: "Last 30 days (up to 10,000 turns)",
      },
      warning: !!row && usage.input + usage.output >= row.token_warning,
    };
  }
  async save(input: unknown) {
    credentialKey(this.env);
    const a = z
      .object({
        apiKey: z.string().trim().min(10).max(500).optional(),
        model: z.string().min(1).max(100),
        tokenWarning: z.number().int().min(1000).max(100000000).default(100000),
      })
      .strict()
      .parse(input);
    if (!supportedModels(this.env).includes(a.model))
      throw new ServiceError("Choose a supported model.");
    const previous = await this.read();
    const key =
      a.apiKey ??
      (previous
        ? decryptCredential(previous.credential, this.actor, this.env)
        : undefined);
    if (!key) throw new ServiceError("Add your OpenAI API key.");
    let response: Response;
    try {
      response = await this.request(
        `https://api.openai.com/v1/models/${encodeURIComponent(a.model)}`,
        {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        },
      );
    } catch {
      throw new ServiceError(
        "Could not validate OpenAI access. Check your network and try again.",
        502,
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ServiceError(
        response.status === 429
          ? "OpenAI rate limited key validation. Try again later."
          : "OpenAI rejected the key or model access. Check your API key and supported model.",
      );
    }
    await response.body?.cancel();
    checked(
      await this.admin
        .from("provider_settings")
        .upsert({
          user_id: this.actor,
          provider: "openai",
          model: a.model,
          credential: encryptCredential(key, this.actor, this.env),
          token_warning: a.tokenWarning,
          updated_at: new Date().toISOString(),
        }),
    );
    return this.status();
  }
  async resolve() {
    const row = await this.read();
    if (!row)
      throw new ServiceError(
        "Add and validate an OpenAI API key in AI settings before starting the agent.",
        400,
      );
    if (!supportedModels(this.env).includes(row.model))
      throw new ServiceError(
        "Your selected model is no longer enabled. Update AI settings.",
      );
    return {
      provider: row.provider as string,
      model: row.model as string,
      apiKey: decryptCredential(row.credential, this.actor, this.env),
    };
  }
  async remove() {
    checked(
      await this.admin
        .from("provider_settings")
        .delete()
        .eq("user_id", this.actor),
    );
    return { ok: true };
  }
}
