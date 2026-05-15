# Omni-AI Hub API for Hermes and OpenClaw

This document describes how to call the production Omni-AI Hub API as a standard HTTP chat service from Hermes, OpenClaw, or any other client that can send JSON and optionally consume SSE.

## Base URL and auth

- Production base URL: `https://omni-ai-hub-peach.vercel.app`
- Auth header for protected routes: `Authorization: Bearer <SERVICE_API_KEY>`
- Public route: `GET /api/health`
- Protected routes: `GET /api/models`, `POST /api/chat`

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

Treat this service as a standard JSON chat backend with optional SSE.

Recommended mapping:

- Base URL: `https://omni-ai-hub-peach.vercel.app`
- Auth header: `Authorization: Bearer <SERVICE_API_KEY>`
- Chat path: `/api/chat`
- Model discovery path: `/api/models`

For OpenClaw:

- Query `/api/models` first and use one returned `model` value.
- Keep `provider` in the request body if the OpenClaw side expects a provider field, but do not rely on direct provider-specific credentials.
- For streaming mode, consume the SSE response and append each token event in order.
- For simple request/response mode, use non-stream JSON and read the final `text` field.

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
- Model availability should always be discovered from `/api/models`, not copied from a stale document.
