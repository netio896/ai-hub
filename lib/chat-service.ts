import { generateText, streamText, type ModelMessage } from "ai";
import { ApiError, jsonError } from "@/lib/http";
import { createLanguageModel, resolveModelSelection } from "@/lib/provider-registry";

export type ChatPayload = {
  messages?: unknown;
  provider?: string;
  model?: string;
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  system?: string;
};

type WireMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function generateChatResponse(payload: ChatPayload) {
  const normalized = normalizeChatPayload(payload);
  const selection = resolveModelSelection(normalized);
  const model = createLanguageModel(selection.provider, selection.id);

  try {
    const result = await generateText({
      model,
      system: normalized.system,
      messages: normalized.messages,
      temperature: normalized.temperature,
      maxOutputTokens: normalized.maxTokens
    });

    return {
      id: result.response?.id ?? null,
      provider: selection.provider,
      model: selection.id,
      text: result.text,
      finishReason: result.finishReason,
      usage: result.usage ?? null
    };
  } catch (error) {
    throw new ApiError(
      502,
      "provider_request_failed",
      toMessage(error),
      selection.provider
    );
  }
}

export async function streamChatResponse(payload: ChatPayload) {
  const normalized = normalizeChatPayload(payload);
  const selection = resolveModelSelection(normalized);
  const model = createLanguageModel(selection.provider, selection.id);

  try {
    const result = streamText({
      model,
      system: normalized.system,
      messages: normalized.messages,
      temperature: normalized.temperature,
      maxOutputTokens: normalized.maxTokens
    });

    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of result.textStream) {
            controller.enqueue(
              encoder.encode(`event: token\ndata: ${JSON.stringify({ text: chunk })}\n\n`)
            );
          }

          controller.enqueue(encoder.encode("event: done\ndata: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          const apiError =
            error instanceof ApiError
              ? error
              : new ApiError(502, "provider_stream_error", toMessage(error), selection.provider);
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify({
                code: apiError.code,
                message: apiError.message,
                provider: apiError.provider
              })}\n\n`
            )
          );
          controller.close();
        }
      }
    });

    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  } catch (error) {
    const apiError = error instanceof ApiError ? error : new ApiError(500, "stream_error", toMessage(error));
    return jsonError(apiError);
  }
}

export function normalizeChatPayload(payload: ChatPayload) {
  if (!payload || typeof payload !== "object") {
    throw new ApiError(400, "invalid_request", "Request body must be a JSON object.");
  }

  const messages = normalizeMessages(payload.messages);
  const system =
    typeof payload.system === "string" && payload.system.trim().length > 0
      ? payload.system.trim()
      : undefined;
  const temperature =
    payload.temperature === undefined ? undefined : normalizeNumber(payload.temperature, "temperature");
  const maxTokens =
    payload.maxTokens === undefined ? undefined : normalizeInteger(payload.maxTokens, "maxTokens");

  return {
    provider: payload.provider,
    model: payload.model,
    system,
    temperature,
    maxTokens,
    messages
  };
}

function normalizeMessages(messages: unknown): ModelMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ApiError(400, "invalid_messages", "Request must include a non-empty messages array.");
  }

  return messages.map((message, index) => normalizeMessage(message, index));
}

function normalizeMessage(message: unknown, index: number): ModelMessage {
  if (!message || typeof message !== "object") {
    throw new ApiError(400, "invalid_messages", `Message at index ${index} must be an object.`);
  }

  const candidate = message as Partial<WireMessage>;
  if (
    candidate.role !== "system" &&
    candidate.role !== "user" &&
    candidate.role !== "assistant"
  ) {
    throw new ApiError(
      400,
      "invalid_messages",
      `Message at index ${index} must have role system, user, or assistant.`
    );
  }

  if (typeof candidate.content !== "string" || candidate.content.trim().length === 0) {
    throw new ApiError(
      400,
      "invalid_messages",
      `Message at index ${index} must have a non-empty string content.`
    );
  }

  return {
    role: candidate.role,
    content: candidate.content
  };
}

function normalizeNumber(value: unknown, field: string) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new ApiError(400, "invalid_request", `${field} must be a valid number.`);
  }

  return value;
}

function normalizeInteger(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ApiError(400, "invalid_request", `${field} must be a positive integer.`);
  }

  return value;
}

export function toMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error";
}
