import { requireServiceAuth } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { listSupportedModels } from "@/lib/provider-registry";

export async function GET(request: Request) {
  const authError = requireServiceAuth(request);
  if (authError) return authError;

  return jsonOk({
    models: listSupportedModels()
  });
}
