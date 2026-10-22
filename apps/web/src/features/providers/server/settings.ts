import type { SupabaseClient } from "@supabase/supabase-js";
import "server-only";
import { z } from "zod";
import { checked, ServiceError } from "../../../shared/db/result";
import {
  credentialKey,
  decryptCredential,
  encryptCredential,
} from "./credentials";
import {
  providerCatalog,
  providerId,
  providerModels,
  validateModel,
  validateProviderKey,
  type ProviderId,
} from "./registry";
export function supportedModels(env: NodeJS.ProcessEnv = process.env) {
  return providerModels("openai", env);
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
  async read(provider: ProviderId = "openai") {
    return checked(
      await this.admin
        .from("provider_settings")
        .select("*")
        .eq("user_id", this.actor)
        .eq("provider", provider)
        .maybeSingle(),
    );
  }
  private async preference() {
    return checked(
      await this.admin
        .from("ai_preferences")
        .select("provider,model")
        .eq("user_id", this.actor)
        .maybeSingle(),
    );
  }
  async status() {
    const rows =
      checked(
        await this.admin
          .from("provider_settings")
          .select("provider,model,token_warning")
          .eq("user_id", this.actor),
      ) ?? [];
    const preference = await this.preference();
    // Never silently select another provider when the active credential is removed.
    const provider: ProviderId = preference?.provider ?? "openai";
    const row = rows.find((r) => r.provider === provider);
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
      provider,
      model:
        preference?.model ??
        row?.model ??
        providerModels(provider, this.env, row?.model)[0] ??
        "",
      models: providerModels(provider, this.env, row?.model),
      tokenWarning: row?.token_warning ?? 100000,
      providers: providerCatalog(
        this.env,
        Object.fromEntries(rows.map((r) => [r.provider, r.model])),
      ).map((p) => {
        const saved = rows.find((r) => r.provider === p.id);
        return {
          ...p,
          configured: !!saved,
          model: saved?.model ?? p.models[0] ?? "",
          tokenWarning: saved?.token_warning ?? 100000,
        };
      }),
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
        provider: providerId.default("openai"),
        apiKey: z.string().trim().min(10).max(500).optional(),
        model: z.string().min(1).max(100),
        tokenWarning: z.number().int().min(1000).max(100000000).default(100000),
      })
      .strict()
      .parse(input);
    const previous = await this.read(a.provider);
    validateModel(a.provider, a.model, this.env, previous?.model);
    const key =
      a.apiKey ??
      (previous
        ? decryptCredential(
            previous.credential,
            this.actor,
            this.env,
            a.provider,
          )
        : undefined);
    if (!key) throw new ServiceError("Add this provider's API key.");
    const validation = await validateProviderKey(
      a.provider,
      a.model,
      key,
      this.request,
    );
    checked(
      await this.admin.from("provider_settings").upsert(
        {
          user_id: this.actor,
          provider: a.provider,
          model: a.model,
          credential: encryptCredential(key, this.actor, this.env, a.provider),
          token_warning: a.tokenWarning,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,provider" },
      ),
    );
    return {
      ...(await this.select({ provider: a.provider, model: a.model })),
      validation,
    };
  }
  async select(input: unknown) {
    const a = z
      .object({ provider: providerId, model: z.string().min(1).max(100) })
      .strict()
      .parse(input);
    const saved = await this.read(a.provider);
    validateModel(a.provider, a.model, this.env, saved?.model);
    if (!saved)
      throw new ServiceError(
        "Add this provider's API key in AI settings first.",
      );
    checked(
      await this.admin
        .from("ai_preferences")
        .upsert(
          { user_id: this.actor, provider: a.provider, model: a.model },
          { onConflict: "user_id" },
        ),
    );
    return this.status();
  }
  async resolve() {
    const preference = await this.preference();
    const provider: ProviderId = preference?.provider ?? "openai";
    const row = await this.read(provider);
    if (!row)
      throw new ServiceError(
        "Add and validate the selected provider's API key in AI settings before starting the agent.",
        400,
      );
    const model = preference?.model ?? row.model;
    validateModel(provider, model, this.env, row.model);
    return {
      provider,
      model: model as string,
      apiKey: decryptCredential(row.credential, this.actor, this.env, provider),
    };
  }
  async remove(input: unknown = {}) {
    const a = z
      .object({ provider: providerId.default("openai") })
      .strict()
      .parse(input);
    checked(
      await this.admin
        .from("provider_settings")
        .delete()
        .eq("user_id", this.actor)
        .eq("provider", a.provider),
    );
    return { ok: true };
  }
}
