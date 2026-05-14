import { generateChatResponse, streamChatResponse } from "@/lib/chat-service";
import { requireServiceAuth } from "@/lib/auth";
import { ApiError, jsonError, toApiError } from "@/lib/http";

export async function POST(request: Request) {
  const authError = requireServiceAuth(request);
  if (authError) return authError;

  try {
    const payload = await request.json();
    if (payload?.stream === true) {
      return await streamChatResponse(payload);
    }

    const response = await generateChatResponse(payload);
    return Response.json(response);
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonError(error);
    }

    return jsonError(toApiError(error));
  }
}
