import { requireServiceAuth } from "@/lib/auth";
import { jsonOk } from "@/lib/http";
import { listOpenAICompatibleModels } from "@/lib/openai-compatible-service";

export async function GET(request: Request) {
  const authError = requireServiceAuth(request);
  if (authError) return authError;

  return jsonOk(listOpenAICompatibleModels());
}
