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
});
