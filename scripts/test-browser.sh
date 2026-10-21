#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
suffix="paw-browser-$$"
network="$suffix-network"
database="$suffix-db"
rest="$suffix-rest"
auth="$suffix-auth"
test_tmp=$(mktemp -d /tmp/paw-browser.XXXXXX)
gateway_pid=''
app_pid=''
cleanup() {
  if [[ -n "$app_pid" ]]; then kill "$app_pid" 2>/dev/null || true; fi
  if [[ -n "$gateway_pid" ]]; then kill "$gateway_pid" 2>/dev/null || true; fi
  docker rm -f "$rest" "$auth" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$test_tmp"
}
trap cleanup EXIT
jwt_secret='paw-local-integration-test-signing-key-at-least-32-chars'
docker network create "$network" >/dev/null
docker run -d --name "$database" --network "$network" -e POSTGRES_PASSWORD=local-paw-test-only postgres:17-alpine >/dev/null
for ((i=0;i<60;i++)); do
  if docker exec "$database" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec -i "$database" psql -U postgres -v ON_ERROR_STOP=1 < tests/auth-bootstrap.sql
docker run -d --name "$auth" --network "$network" -p 127.0.0.1::9999 \
  -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 \
  -e API_EXTERNAL_URL=http://localhost:3100 -e GOTRUE_SITE_URL=http://localhost:3100 \
  -e GOTRUE_DB_DRIVER=postgres -e "GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:local-paw-auth-test-only@$database:5432/postgres" \
  -e "GOTRUE_JWT_SECRET=$jwt_secret" -e GOTRUE_JWT_EXP=3600 \
  -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_AUD=authenticated \
  -e GOTRUE_DISABLE_SIGNUP=false -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
  supabase/gotrue:v2.186.0 >/dev/null
auth_port=$(docker port "$auth" 9999/tcp | cut -d: -f2)
for ((i=0;i<60;i++)); do
  if curl --silent --fail "http://127.0.0.1:$auth_port/health" >/dev/null; then break; fi
  if [[ "$(docker inspect --format '{{.State.Running}}' "$auth")" != true ]]; then docker logs "$auth"; exit 1; fi
  sleep 1
done
curl --silent --fail "http://127.0.0.1:$auth_port/health" >/dev/null
docker exec -i "$database" psql -U postgres -v ON_ERROR_STOP=1 < tests/auth-claims.sql
for migration in supabase/migrations/*.sql; do
  if [[ "$migration" == *202610200004_agent.sql && ! -f supabase/migrations/202610200003_conversations.sql ]]; then
    docker exec -i "$database" psql -U postgres -v ON_ERROR_STOP=1 < tests/historical-conversations.sql
  fi
  docker exec -i "$database" psql -U postgres -v ON_ERROR_STOP=1 < "$migration"
done
docker run -d --name "$rest" --network "$network" -p 127.0.0.1::3000 \
  -e "PGRST_DB_URI=postgres://authenticator:local-paw-test-only@$database:5432/postgres" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e "PGRST_JWT_SECRET=$jwt_secret" postgrest/postgrest:v12.2.12 >/dev/null
rest_port=$(docker port "$rest" 3000/tcp | cut -d: -f2)
export PAW_LOCAL_AUTH="http://127.0.0.1:$auth_port" PAW_LOCAL_REST="http://127.0.0.1:$rest_port" PAW_GATEWAY_PORT_FILE="$test_tmp/gateway-port"
node tests/gateway.mjs &
gateway_pid=$!
for ((i=0;i<20;i++)); do if [[ -s "$PAW_GATEWAY_PORT_FILE" ]]; then break; fi; sleep 1; done
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$(cat "$PAW_GATEWAY_PORT_FILE")"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='local-browser-test-only'
export PAW_CREDENTIAL_ENCRYPTION_KEY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))')"
export PAW_TEST_JWT_SECRET="$jwt_secret"
unset SUPABASE_SECRET_KEY
export SUPABASE_SERVICE_ROLE_KEY="$(node tests/service-token.mjs)"
# Override .env.local for this process only. Next serves the already-built app.
node node_modules/next/dist/bin/next start apps/web -H localhost -p 3100 >"$test_tmp/app.log" 2>&1 &
app_pid=$!
for ((i=0;i<30;i++)); do
  if curl --silent --fail http://localhost:3100/api/auth/session >/dev/null; then break; fi
  sleep 1
done
export PAW_BROWSER_TEST_URL=http://localhost:3100
if ! npx --no-install playwright test "$@"; then cat "$test_tmp/app.log"; docker logs "$auth" --tail 20; exit 1; fi
