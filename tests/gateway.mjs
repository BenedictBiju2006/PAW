// Minimal local test routing only; production uses Supabase's HTTPS gateway.
import http from "node:http";
import { writeFileSync } from "node:fs";
const server = http.createServer((req, res) => {
  const auth = req.url.startsWith("/auth/v1");
  const target = auth ? process.env.PAW_LOCAL_AUTH : process.env.PAW_LOCAL_REST;
  const url = new URL(
    req.url.replace(auth ? "/auth/v1" : "/rest/v1", "") || "/",
    target,
  );
  const upstream = http.request(
    url,
    { method: req.method, headers: { ...req.headers, host: url.host } },
    (result) => {
      res.writeHead(result.statusCode, result.headers);
      result.pipe(res);
    },
  );
  upstream.on("error", () => {
    res.writeHead(502);
    res.end("Local test backend unavailable");
  });
  req.pipe(upstream);
});
server.listen(0, "127.0.0.1", () =>
  writeFileSync(
    process.env.PAW_GATEWAY_PORT_FILE,
    String(server.address().port),
  ),
);
