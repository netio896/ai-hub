import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  delete process.env.SERVICE_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_API_KEY;
});

describe("API routes", () => {
  it("health route reports provider readiness without auth", async () => {
    process.env.OPENAI_BASE_URL = "http://relay.example/v1";
    process.env.OPENAI_API_KEY = "openai";

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      service: "omni-ai-hub-api",
      providers: {
        openai: true,
        anthropic: true,
        xai: true
      }
    });
  });

  it("models route rejects missing bearer token", async () => {
    process.env.SERVICE_API_KEY = "secret";

    const { GET } = await import("@/app/api/models/route");
    const response = await GET(new Request("http://localhost/api/models"));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("unauthorized");
  });

  it("OpenAI-compatible models route rejects missing bearer token", async () => {
    process.env.SERVICE_API_KEY = "secret";

    const { GET } = await import("@/app/v1/models/route");
    const response = await GET(new Request("http://localhost/v1/models"));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("unauthorized");
  });

  it("OpenAI-compatible models route returns a standard model list", async () => {
    process.env.SERVICE_API_KEY = "secret";

    const { GET } = await import("@/app/v1/models/route");
    const response = await GET(
      new Request("http://localhost/v1/models", {
        headers: {
          Authorization: "Bearer secret"
        }
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.object).toBe("list");
    expect(payload.data).toContainEqual({
      id: "gpt-5.2",
      object: "model",
      created: 0,
      owned_by: "openai"
    });
  });

  it("chat route rejects unsupported provider", async () => {
    process.env.SERVICE_API_KEY = "secret";

    const { POST } = await import("@/app/api/chat/route");
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          provider: "invalid",
          messages: [{ role: "user", content: "hello" }]
        })
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("unsupported_provider");
  });

  it("chat route returns normalized JSON for non-stream requests", async () => {
    process.env.SERVICE_API_KEY = "secret";
    process.env.OPENAI_BASE_URL = "http://relay.example/v1";
    process.env.OPENAI_API_KEY = "openai";

    const generateText = vi.fn().mockResolvedValue({
      text: "Hello from OpenAI",
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      response: { id: "resp_123" }
    });

    vi.doMock("ai", () => ({
      generateText,
      streamText: vi.fn()
    }));

    const { POST } = await import("@/app/api/chat/route");
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          provider: "openai",
          model: "gpt-5.2",
          messages: [{ role: "user", content: "Say hi" }]
        })
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      id: "resp_123",
      provider: "openai",
      model: "gpt-5.2",
      text: "Hello from OpenAI",
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }
    });
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("chat route returns SSE for stream requests", async () => {
    process.env.SERVICE_API_KEY = "secret";
    process.env.OPENAI_BASE_URL = "http://relay.example/v1";
    process.env.OPENAI_API_KEY = "openai";

    const streamText = vi.fn().mockReturnValue({
      textStream: (async function* () {
        yield "Hello";
        yield " world";
      })()
    });

    vi.doMock("ai", () => ({
      generateText: vi.fn(),
      streamText
    }));

    const { POST } = await import("@/app/api/chat/route");
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          provider: "openai",
          model: "gpt-5.2",
          stream: true,
          messages: [{ role: "user", content: "Stream hi" }]
        })
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const body = await response.text();
    expect(body).toContain('event: token');
    expect(body).toContain('data: {"text":"Hello"}');
    expect(body).toContain('data: {"text":" world"}');
    expect(body).toContain("event: done");
    expect(streamText).toHaveBeenCalledOnce();
  });

  it("OpenAI-compatible chat route returns normalized JSON for non-stream requests", async () => {
    process.env.SERVICE_API_KEY = "secret";
    process.env.OPENAI_BASE_URL = "http://relay.example/v1";
    process.env.OPENAI_API_KEY = "openai";

    const generateText = vi.fn().mockResolvedValue({
      text: "Hello from Omni",
      finishReason: "stop",
      usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 },
      response: { id: "chatcmpl_test" }
    });

    vi.doMock("ai", () => ({
      generateText,
      streamText: vi.fn()
    }));

    const { POST } = await import("@/app/v1/chat/completions/route");
    const response = await POST(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-5.2",
          max_tokens: 64,
          messages: [{ role: "user", content: "Say hi" }]
        })
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      id: "chatcmpl_test",
      object: "chat.completion",
      created: expect.any(Number),
      model: "gpt-5.2",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Hello from Omni"
          },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 7,
        total_tokens: 12
      }
    });
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 64
      })
    );
  });

  it("OpenAI-compatible chat route ignores empty context messages", async () => {
    process.env.SERVICE_API_KEY = "secret";
    process.env.OPENAI_BASE_URL = "http://relay.example/v1";
    process.env.OPENAI_API_KEY = "openai";

    const generateText = vi.fn().mockResolvedValue({
      text: "OK",
      finishReason: "stop",
      usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      response: { id: "chatcmpl_empty_context" }
    });

    vi.doMock("ai", () => ({
      generateText,
      streamText: vi.fn()
    }));

    const { POST } = await import("@/app/v1/chat/completions/route");
    const response = await POST(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-5.2",
          messages: [
            { role: "user", content: "Reply OK" },
            { role: "assistant", content: "" }
          ]
        })
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.choices[0].message.content).toBe("OK");
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "Reply OK" }]
      })
    );
  });

  it("OpenAI-compatible chat route returns SSE chunks for stream requests", async () => {
    process.env.SERVICE_API_KEY = "secret";
    process.env.OPENAI_BASE_URL = "http://relay.example/v1";
    process.env.OPENAI_API_KEY = "openai";

    const streamText = vi.fn().mockReturnValue({
      textStream: (async function* () {
        yield "Hello";
        yield " OpenClaw";
      })()
    });

    vi.doMock("ai", () => ({
      generateText: vi.fn(),
      streamText
    }));

    const { POST } = await import("@/app/v1/chat/completions/route");
    const response = await POST(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-5.2",
          stream: true,
          messages: [{ role: "user", content: "Stream hi" }]
        })
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const body = await response.text();
    expect(body).toContain("data: {");
    expect(body).toContain('"object":"chat.completion.chunk"');
    expect(body).toContain('"content":"Hello"');
    expect(body).toContain('"content":" OpenClaw"');
    expect(body).toContain("data: [DONE]");
    expect(streamText).toHaveBeenCalledOnce();
  });

  it("OpenAI-compatible chat route rejects unsupported models", async () => {
    process.env.SERVICE_API_KEY = "secret";
    process.env.OPENAI_BASE_URL = "http://relay.example/v1";
    process.env.OPENAI_API_KEY = "openai";

    const { POST } = await import("@/app/v1/chat/completions/route");
    const response = await POST(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "not-a-model",
          messages: [{ role: "user", content: "hello" }]
        })
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("unsupported_model");
  });
});
