import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { ServiceError } from "../../../shared/db/result";
const envelope = z
  .object({
    version: z.literal(1),
    keyVersion: z.string(),
    nonce: z.string(),
    tag: z.string(),
    ciphertext: z.string(),
  })
  .strict();
export function credentialKey(env: NodeJS.ProcessEnv = process.env) {
  const encoded = env.PAW_CREDENTIAL_ENCRYPTION_KEY;
  if (
    !encoded ||
    !/^[A-Za-z0-9+/]{43}=$/.test(encoded) ||
    Buffer.from(encoded, "base64").length !== 32
  )
    throw new ServiceError(
      "AI credential storage is disabled. Configure PAW_CREDENTIAL_ENCRYPTION_KEY with a base64-encoded 32-byte key.",
      503,
    );
  return {
    key: Buffer.from(encoded, "base64"),
    version: env.PAW_CREDENTIAL_KEY_VERSION || "1",
  };
}
export function encryptCredential(
  secret: string,
  userId: string,
  env: NodeJS.ProcessEnv = process.env,
  provider: string = "openai",
) {
  const { key, version } = credentialKey(env),
    nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`paw:${provider}:${userId}:${version}`));
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    keyVersion: version,
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}
export function decryptCredential(
  value: unknown,
  userId: string,
  env: NodeJS.ProcessEnv = process.env,
  provider: string = "openai",
) {
  try {
    const e = envelope.parse(value),
      { key, version } = credentialKey(env);
    if (e.keyVersion !== version) throw new Error("Key version mismatch");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(e.nonce, "base64"),
    );
    decipher.setAAD(Buffer.from(`paw:${provider}:${userId}:${version}`));
    decipher.setAuthTag(Buffer.from(e.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(e.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new ServiceError(
      "Unable to decrypt the provider key. Check the server encryption configuration or replace your key.",
      503,
    );
  }
}
