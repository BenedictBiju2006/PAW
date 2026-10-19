import { writeFileSync } from "node:fs";
import { catalogDocument } from "../packages/a2ui/catalog";
writeFileSync(
  new URL("../packages/a2ui/catalog.json", import.meta.url),
  JSON.stringify(catalogDocument(), null, 2) + "\n",
);
