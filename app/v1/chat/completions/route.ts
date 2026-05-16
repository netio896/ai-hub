import {
  generateOpenAIChatCompletion,
  streamOpenAIChatCompletion
} from "@/lib/openai-compatible-service";
import { requireServiceAuth } from "@/lib/auth";
import { ApiError, jsonError, toApiError } from "@/lib/http";

export async function POST(request: Request) {
  const authError = requireServiceAuth(request);
  if (authError) return authError;

  try {
    const payload = await request.json();
    if (payload?.stream === true) {
      return await streamOpenAIChatCompletion(payload);
    }

    return Response.json(await generateOpenAIChatCompletion(payload));
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonError(error);
    }

    return jsonError(toApiError(error));
  }
}
