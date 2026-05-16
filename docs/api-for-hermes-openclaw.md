# Omni-AI Hub API for Hermes and OpenClaw

This document describes how to call the production Omni-AI Hub API as a standard HTTP chat service from Hermes, OpenClaw, or any other client that can send JSON and optionally consume SSE.

## Base URL and auth

- Production base URL: `https://omni-ai-hub-peach.vercel.app`
- Auth header for protected routes: `Authorization: Bearer <SERVICE_API_KEY>`
- Public route: `GET /api/health`
- Protected native routes: `GET /api/models`, `POST /api/chat`
- Protected OpenAI-compatible routes: `GET /v1/models`, `POST /v1/chat/completions`

## Key boundary / 密钥边界

Keep client-facing service auth and server-side relay auth separate.

- OpenClaw/Hermes -> AI Hub: use `SERVICE_API_KEY` as `Authorization: Bearer <SERVICE_API_KEY>`.
- AI Hub -> OpenAI-compatible relay: use server-side `OPENAI_BASE_URL` and `OPENAI_API_KEY`.
- Do not put `OPENAI_API_KEY` in OpenClaw/Hermes configs, and do not use it as the client bearer token for AI Hub.

中文规则：

- `SERVICE_API_KEY` 是客户端调用 AI Hub 的服务密钥。
- `OPENAI_API_KEY` 是 AI Hub 服务端调用中转的密钥。
- 两者不可混用，OpenClaw/Hermes 不应持有中转 key。

## Endpoint summary

### `GET /api/health`

Use this to verify the deployment is alive and the relay-backed providers are configured.

Example:

```bash
curl https://omni-ai-hub-peach.vercel.app/api/health
```

Expected response shape:

```json
{
  "ok": true,
  "service": "omni-ai-hub-api",
  "providers": {
    "openai": true,
    "anthropic": true,
    "xai": true
  }
}
```

### `GET /api/models`

Use this before chat calls so the client can discover the currently exposed model ids instead of hardcoding assumptions.

Example:

```bash
curl https://omni-ai-hub-peach.vercel.app/api/models \
  -H "Authorization: Bearer <SERVICE_API_KEY>"
```

Expected response shape:

```json
{
  "models": [
    {
      "provider": "openai",
      "model": "gpt-5.2",
      "label": "GPT-5.2",
      "capabilities": {
        "stream": true
      },
      "default": true
    }
  ]
}
```

### `POST /api/chat`

Use this as the main chat endpoint. The request body is JSON.

Fields:

- `messages`: required array of chat messages
- `provider`: optional compatibility field
- `model`: optional but recommended; fetch from `/api/models`
- `stream`: optional boolean; `true` enables SSE
- `temperature`: optional number
- `maxTokens`: optional positive integer
- `system`: optional system prompt string

Each `messages` item must have:

- `role`: `system`, `user`, or `assistant`
- `content`: non-empty string

Note:

- `provider` remains in the request shape for compatibility.
- The backend now routes all supported models through one OpenAI-compatible relay.

## Non-stream chat

Example request:

```bash
curl https://omni-ai-hub-peach.vercel.app/api/chat \
  -H "Authorization: Bearer <SERVICE_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "model": "gpt-5.2",
    "stream": false,
    "messages": [
      { "role": "user", "content": "ping" }
    ]
  }'
```

Expected response shape:

```json
{
  "id": "resp_xxx",
  "provider": "openai",
  "model": "gpt-5.2",
  "text": "pong",
  "finishReason": "stop",
  "usage": {
    "inputTokens": 7,
    "outputTokens": 5,
    "totalTokens": 12
  }
}
```

## Stream chat with SSE

Set `stream` to `true` to receive server-sent events.

Example request:

```bash
curl https://omni-ai-hub-peach.vercel.app/api/chat \
  -H "Authorization: Bearer <SERVICE_API_KEY>" \
  -H "Content-Type: application/json" \
  -N \
  -d '{
    "provider": "openai",
    "model": "gpt-5.2",
    "stream": true,
    "messages": [
      { "role": "user", "content": "hello" }
    ]
  }'
```

Expected behavior:

- Response header includes `Content-Type: text/event-stream; charset=utf-8`
- Partial text arrives as repeated `event: token`
- Stream ends with `event: done`

Example SSE shape:

```text
event: token
data: {"text":"Hel"}

event: token
data: {"text":"lo"}

event: done
data: [DONE]
```

If an upstream streaming failure happens after the stream starts, the API emits:

```text
event: error
data: {"code":"provider_stream_error","message":"...","provider":"openai"}
```

## Hermes integration notes

Treat this service as a standard HTTP chat endpoint.

Recommended mapping:

- Base URL: `https://omni-ai-hub-peach.vercel.app`
- Auth header: `Authorization: Bearer <SERVICE_API_KEY>`
- Chat path: `/api/chat`
- Model discovery path: `/api/models`
- Health check path: `/api/health`

For Hermes:

- Use `/api/models` first if the Hermes setup supports dynamic model discovery.
- If Hermes supports streaming, consume SSE and concatenate each `event: token` payload's `text`.
- If Hermes only supports non-stream mode, set `stream` to `false` or omit it.
- Do not assume the old direct-provider auth model; this endpoint already hides relay routing behind one HTTP API.

## OpenClaw integration notes

Use the OpenAI-compatible adapter path for OpenClaw. This matches OpenClaw's existing `openai-completions` provider schema and avoids custom `/api/chat` client glue.

Recommended mapping:

- Provider id: `omni-ai-hub`
- Base URL: `https://omni-ai-hub-peach.vercel.app/v1`
- API key: `<SERVICE_API_KEY>`
- API adapter: `openai-completions`
- Chat path resolved by OpenClaw: `/v1/chat/completions`
- Model discovery path resolved by OpenClaw: `/v1/models`

Minimal provider shape:

```json
{
  "models": {
    "providers": {
      "omni-ai-hub": {
        "baseUrl": "https://omni-ai-hub-peach.vercel.app/v1",
        "apiKey": "<SERVICE_API_KEY>",
        "api": "openai-completions",
        "models": [
          {
            "id": "gpt-5.2",
            "name": "gpt-5.2",
            "contextWindow": 128000
          }
        ]
      }
    }
  }
}
```

For OpenClaw:

- Use `omni-ai-hub/gpt-5.2` as the first test model.
- Do not put the relay key or `OPENAI_API_KEY` in OpenClaw; use only `SERVICE_API_KEY`.
- If streaming is enabled, OpenClaw receives standard OpenAI-style `data:` chunks ending with `data: [DONE]`.
- The existing `/api/chat` route remains available for clients that are not OpenAI-compatible.

## OpenAI-compatible endpoints

### `GET /v1/models`

Example:

```bash
curl https://omni-ai-hub-peach.vercel.app/v1/models \
  -H "Authorization: Bearer <SERVICE_API_KEY>"
```

Expected response shape:

```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-5.2",
      "object": "model",
      "created": 0,
      "owned_by": "openai"
    }
  ]
}
```

### `POST /v1/chat/completions`

Example non-stream request:

```bash
curl https://omni-ai-hub-peach.vercel.app/v1/chat/completions \
  -H "Authorization: Bearer <SERVICE_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.2",
    "stream": false,
    "max_tokens": 800,
    "messages": [
      { "role": "user", "content": "ping" }
    ]
  }'
```

Expected response shape:

```json
{
  "id": "chatcmpl_xxx",
  "object": "chat.completion",
  "created": 1770000000,
  "model": "gpt-5.2",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "pong"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 7,
    "completion_tokens": 5,
    "total_tokens": 12
  }
}
```

Example stream request:

```bash
curl https://omni-ai-hub-peach.vercel.app/v1/chat/completions \
  -H "Authorization: Bearer <SERVICE_API_KEY>" \
  -H "Content-Type: application/json" \
  -N \
  -d '{
    "model": "gpt-5.2",
    "stream": true,
    "messages": [
      { "role": "user", "content": "hello" }
    ]
  }'
```

Expected stream shape:

```text
data: {"id":"chatcmpl_xxx","object":"chat.completion.chunk","created":1770000000,"model":"gpt-5.2","choices":[{"index":0,"delta":{"content":"Hel"},"finish_reason":null}]}

data: {"id":"chatcmpl_xxx","object":"chat.completion.chunk","created":1770000000,"model":"gpt-5.2","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}

data: [DONE]
```

## Error envelope and common failures

Non-stream errors return JSON in this shape:

```json
{
  "error": {
    "code": "unsupported_model",
    "message": "Model \"...\" is not supported for provider \"openai\".",
    "provider": "openai"
  }
}
```

Common cases:

- `401 unauthorized`: missing or invalid bearer token
- `400 unsupported_model`: model not present in `/api/models`
- `400 invalid_messages`: messages array missing, empty, or malformed
- `502 provider_request_failed`: request reached the server but the upstream relay rejected or failed it
- `503 service_key_not_configured`: server missing `SERVICE_API_KEY`
- `503 provider_not_configured`: relay env is not configured on the server

## Current limitations

- Only chat endpoints are implemented right now.
- `POST /api/image`, `POST /api/tts`, and `POST /api/stt` are not available yet.
- OpenAI-compatible `/v1/images/generations`, `/v1/audio/*`, and `/v1/embeddings` are not implemented.
- Model availability should always be discovered from `/api/models`, not copied from a stale document.
