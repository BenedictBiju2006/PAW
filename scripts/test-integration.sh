#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Isolated test containers; no hosted credentials or data are used.
suffix="paw-test-$$"
network="$suffix-network"
database="$suffix-db"
rest="$suffix-rest"
cleanup() {
  docker rm -f "$rest" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
export PAW_TEST_JWT_SECRET='paw-local-integration-test-signing-key-at-least-32-chars'
docker network create "$network" >/dev/null
docker run -d --name "$database" --network "$network" -e POSTGRES_PASSWORD=local-paw-test-only postgres:17-alpine >/dev/null
for ((i=0;i<60;i++)); do
  if docker exec "$database" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec -i "$database" psql -U postgres -v ON_ERROR_STOP=1 < tests/bootstrap.sql
for migration in supabase/migrations/*.sql; do
  docker exec -i "$database" psql -U postgres -v ON_ERROR_STOP=1 < "$migration"
  if [[ "$migration" == *202610200004_agent.sql ]]; then
    docker exec -i "$database" psql -U postgres -v ON_ERROR_STOP=1 < tests/provider-legacy.sql
  fi
  if [[ "$migration" == *202610200001_milestone_one.sql ]]; then
    docker exec -i "$database" psql -U postgres -v ON_ERROR_STOP=1 < tests/legacy-fixture.sql
  fi
done
docker run -d --name "$rest" --network "$network" -p 127.0.0.1::3000 \
  -e "PGRST_DB_URI=postgres://authenticator:local-paw-test-only@$database:5432/postgres" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e "PGRST_JWT_SECRET=$PAW_TEST_JWT_SECRET" postgrest/postgrest:v12.2.12 >/dev/null
port=$(docker port "$rest" 3000/tcp | cut -d: -f2)
export PAW_TEST_REST_URL="http://127.0.0.1:$port"
for ((i=0;i<30;i++)); do
  if curl --silent --fail "$PAW_TEST_REST_URL" >/dev/null; then break; fi
  sleep 1
done
node --import tsx --test tests/integration.test.ts
