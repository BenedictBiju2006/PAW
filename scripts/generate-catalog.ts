import { writeFileSync } from "node:fs";
import { catalogDocument } from "../apps/web/src/features/interfaces/protocol/catalog";
writeFileSync(
  new URL("../apps/web/src/features/interfaces/protocol/catalog.json", import.meta.url),
  JSON.stringify(catalogDocument(), null, 2) + "\n",
);
