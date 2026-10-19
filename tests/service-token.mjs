// Disposable local backend only. No production credential is read or created.
import { createHmac } from "node:crypto";
const header = Buffer.from(
  JSON.stringify({ alg: "HS256", typ: "JWT" }),
).toString("base64url");
const payload = Buffer.from(
  JSON.stringify({
    role: "service_role",
    exp: Math.floor(Date.now() / 1000) + 3600,
  }),
).toString("base64url");
const signature = createHmac("sha256", process.env.PAW_TEST_JWT_SECRET)
  .update(`${header}.${payload}`)
  .digest("base64url");
process.stdout.write(`${header}.${payload}.${signature}`);
