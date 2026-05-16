import { generateText, streamText } from "ai";
import { ApiError, jsonError } from "@/lib/http";
import { createLanguageModel, listSupportedModels, resolveModelSelection } from "@/lib/provider-registry";
import { normalizeChatPayload, toMessage, type ChatPayload } from "@/lib/chat-service";

type OpenAIChatPayload = Omit<ChatPayload, "maxTokens"> & {
  max_tokens?: number;
};

function toChatPayload(payload: OpenAIChatPayload): ChatPayload {
  return {
    messages: payload.messages,
    model: payload.model,
    stream: payload.stream,
    temperature: payload.temperature,
    maxTokens: payload.max_tokens
  };
}

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
  const normalized = normalizeChatPayload(toChatPayload(payload));
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
  const normalized = normalizeChatPayload(toChatPayload(payload));
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
