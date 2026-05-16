import { generateText, streamText, type ModelMessage } from "ai";
import { ApiError, jsonError } from "@/lib/http";
import { createLanguageModel, listSupportedModels, resolveModelSelection } from "@/lib/provider-registry";
import { toMessage, type ChatPayload } from "@/lib/chat-service";

type OpenAIChatPayload = Omit<ChatPayload, "maxTokens"> & {
  max_tokens?: number;
};

export function listOpenAICompatibleModels() {
  return {
    object: "list",
    data: listSupportedModels().map((entry) => ({
      id: entry.model,
      object: "model",
      created: 0,
      owned_by: entry.provider
    }))
  };
}

export async function generateOpenAIChatCompletion(payload: OpenAIChatPayload) {
  const normalized = normalizeOpenAIChatPayload(payload);
  const selection = resolveModelSelection(normalized);
  const model = createLanguageModel(selection.provider, selection.id);

  try {
    const result = await generateText({
      model,
      messages: normalized.messages,
      temperature: normalized.temperature,
      maxOutputTokens: normalized.maxTokens
    });

    return {
      id: result.response?.id ?? `chatcmpl_${crypto.randomUUID()}`,
      object: "chat.completion",
      created: unixNow(),
      model: selection.id,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: result.text
          },
          finish_reason: result.finishReason ?? null
        }
      ],
      usage: toOpenAIUsage(result.usage)
    };
  } catch (error) {
    throw new ApiError(502, "provider_request_failed", toMessage(error), selection.provider);
  }
}

export async function streamOpenAIChatCompletion(payload: OpenAIChatPayload) {
  const normalized = normalizeOpenAIChatPayload(payload);
  const selection = resolveModelSelection(normalized);
  const model = createLanguageModel(selection.provider, selection.id);
  const id = `chatcmpl_${crypto.randomUUID()}`;
  const created = unixNow();

  try {
    const result = streamText({
      model,
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
              encoder.encode(
                `data: ${JSON.stringify({
                  id,
                  object: "chat.completion.chunk",
                  created,
                  model: selection.id,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        content: chunk
                      },
                      finish_reason: null
                    }
                  ]
                })}\n\n`
              )
            );
          }

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                id,
                object: "chat.completion.chunk",
                created,
                model: selection.id,
                choices: [
                  {
                    index: 0,
                    delta: {},
                    finish_reason: "stop"
                  }
                ]
              })}\n\n`
            )
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          const apiError =
            error instanceof ApiError
              ? error
              : new ApiError(502, "provider_stream_error", toMessage(error), selection.provider);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                error: {
                  code: apiError.code,
                  message: apiError.message,
                  provider: apiError.provider
                }
              })}\n\n`
            )
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
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
    const apiError =
      error instanceof ApiError ? error : new ApiError(500, "stream_error", toMessage(error));
    return jsonError(apiError);
  }
}

function normalizeOpenAIChatPayload(payload: OpenAIChatPayload) {
  if (!payload || typeof payload !== "object") {
    throw new ApiError(400, "invalid_request", "Request body must be a JSON object.");
  }

  const messages = normalizeOpenAIMessages(payload.messages);
  const temperature =
    payload.temperature === undefined ? undefined : normalizeNumber(payload.temperature, "temperature");
  const maxTokens =
    payload.max_tokens === undefined ? undefined : normalizeInteger(payload.max_tokens, "max_tokens");

  return {
    provider: payload.provider,
    model: payload.model,
    temperature,
    maxTokens,
    messages
  };
}

function normalizeOpenAIMessages(messages: unknown): ModelMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ApiError(400, "invalid_messages", "Request must include a non-empty messages array.");
  }

  const normalized = messages.flatMap((message, index) => {
    const normalizedMessage = normalizeOpenAIMessage(message, index);
    return normalizedMessage ? [normalizedMessage] : [];
  });

  if (normalized.length === 0) {
    throw new ApiError(400, "invalid_messages", "Request must include at least one non-empty text message.");
  }

  return normalized;
}

function normalizeOpenAIMessage(message: unknown, index: number): ModelMessage | null {
  if (!message || typeof message !== "object") {
    throw new ApiError(400, "invalid_messages", `Message at index ${index} must be an object.`);
  }

  const candidate = message as {
    role?: unknown;
    content?: unknown;
  };

  if (
    candidate.role !== "system" &&
    candidate.role !== "user" &&
    candidate.role !== "assistant" &&
    candidate.role !== "tool"
  ) {
    throw new ApiError(
      400,
      "invalid_messages",
      `Message at index ${index} must have role system, user, assistant, or tool.`
    );
  }

  const content = extractTextContent(candidate.content);
  if (!content) {
    return null;
  }

  if (candidate.role === "tool") {
    return null;
  }

  return {
    role: candidate.role,
    content
  };
}

function extractTextContent(content: unknown) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      const candidate = part as {
        type?: unknown;
        text?: unknown;
      };

      return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
    })
    .join("\n")
    .trim();
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

function toOpenAIUsage(usage: unknown) {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const candidate = usage as {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };

  return {
    prompt_tokens: candidate.inputTokens ?? 0,
    completion_tokens: candidate.outputTokens ?? 0,
    total_tokens:
      candidate.totalTokens ?? (candidate.inputTokens ?? 0) + (candidate.outputTokens ?? 0)
  };
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}
