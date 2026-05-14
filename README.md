# Omni-AI Hub

Next.js + Vercel API wrapper for Hermes/OpenClaw, with the original Puter-powered UI preserved at `/legacy/index.html`.

## Available endpoints

- `GET /api/health`
- `GET /api/models`
- `POST /api/chat`

`/api/chat` accepts:

```json
{
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "provider": "openai",
  "model": "gpt-5.2",
  "stream": false,
  "temperature": 0.7,
  "maxTokens": 800,
  "system": "You are a helpful assistant."
}
```

Auth:

- `/api/health` is public
- all other `/api/*` routes require `Authorization: Bearer <SERVICE_API_KEY>`

## Environment

Copy `.env.example` to `.env.local` and fill in:

- `SERVICE_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `XAI_API_KEY`

## Planned next endpoints

These are reserved for the next phase and are intentionally not implemented yet:

- `POST /api/image`
- `POST /api/tts`
- `POST /api/stt`

## Local development

```bash
npm install
npm run dev
```

The current human UI remains available at:

- `http://localhost:3000/legacy/index.html`
