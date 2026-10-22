import "server-only";
import { ServiceError } from "../../../shared/db/result";
import type { FeatureRequest } from "../../../shared/http/request";
import type { ProviderSettingsService } from "./settings";
export async function handleSettings(
  req: FeatureRequest,
  settings: ProviderSettingsService,
) {
  const { body } = req;
  const result =
    req.method === "GET"
      ? await settings.status()
      : req.method === "PUT"
        ? await settings.save(body)
        : req.method === "PATCH"
          ? await settings.select(body)
          : req.method === "DELETE"
            ? await settings.remove(body)
            : null;
  if (!result) throw new ServiceError("Method not allowed.", 405);
  return result;
}
