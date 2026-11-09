// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestPost } from "../functions/api/chat";
import { parseModelOutput } from "../server/chat/model";
import type { Database } from "../server/chat/contracts";

const valid = {
  message: "あ".repeat(80),
  emotion: "empathetic",
  cocktailId: null,
  memory: { topic: "仕事", mood: "疲れ" },
};
function database(profile: { summary_text: string; version: number } | null = null) {
  const writes: unknown[][] = [];
  const reads: string[] = [];
  const db: Database = {
    prepare(sql) {
      let args: unknown[] = [];
      return {
        bind(...values) {
          args = values;
          return this;
        },
        async first<T>() {
          reads.push(sql);
          return (sql.includes("FROM users") ? { id: "verified" } : profile) as T | null;
        },
        async all<T>() {
          return { results: [] as T[] };
        },
        async run() {
          writes.push([sql, ...args]);
          return {};
        },
      };
    },
  };
  return { db, reads, writes };
}
function context(db: Database, message: unknown = "こんばんは", userId?: string) {
  return {
    request: new Request("https://example.test/api/chat", {
      method: "POST",
      body: JSON.stringify({ message, userId: "attacker" }),
    }),
    env: { DB: db, OPENAI_API_KEY: "test-key" },
    ...(userId ? { data: { userId } } : {}),
  };
}
function provider(content = JSON.stringify(valid), extra = {}) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ finish_reason: "stop", message: { content }, ...extra }] }),
      ),
    );
}
afterEach(() => vi.restoreAllMocks());
describe("structured response", () => {
  it.each([79, 121])("rejects %i characters", (length) => {
    expect(() => parseModelOutput({ ...valid, message: "あ".repeat(length) }, [])).toThrow();
  });
  it.each([80, 120])("accepts %i Unicode codepoints", (length) => {
    expect(parseModelOutput({ ...valid, message: "🌙".repeat(length) }, []).reply.message).toBe(
      "🌙".repeat(length),
    );
  });
  it("rejects invented cocktails and free-text memory", () => {
    expect(() => parseModelOutput({ ...valid, cocktailId: "invented" }, [])).toThrow();
    expect(() =>
      parseModelOutput({ ...valid, memory: { topic: "山田太郎", mood: "疲れ" } }, []),
    ).toThrow();
  });
  it("uses database card metadata", () => {
    const card = { id: "a", name: "名", phrase: "言葉", description: "説明", imageUrl: "/a.png" };
    expect(parseModelOutput({ ...valid, cocktailId: "a" }, [card]).reply.cocktailCard).toEqual(
      card,
    );
  });
});
describe("chat endpoint", () => {
  it("ignores body identity for anonymous users", async () => {
    const { db, reads, writes } = database();
    const fetchMock = provider();
    const response = await onRequestPost(context(db));
    expect(await response.json()).toEqual({
      message: valid.message,
      emotion: valid.emotion,
      cocktailCard: null,
    });
    expect(reads).toEqual([]);
    expect(writes).toEqual([]);
    const payload = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(payload.response_format.json_schema.strict).toBe(true);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("reads prior summary and updates only the verified profile/version", async () => {
    const { db, writes } = database({ summary_text: "相談：休息。", version: 3 });
    const fetchMock = provider();
    await onRequestPost(context(db, "こんにちは", "verified"));
    expect(writes[0]?.slice(1)).toEqual(["相談：仕事。気分：疲れ。", "verified", 3]);
    expect(fetchMock.mock.calls[0]![1]!.body).toContain("相談：休息。");
  });
  it("creates the first profile without overwriting concurrent inserts", async () => {
    const { db, writes } = database();
    provider();
    await onRequestPost(context(db, "こんにちは", "verified"));
    expect(writes[0]?.[0]).toContain("ON CONFLICT(user_id) DO NOTHING");
  });
  it.each(["", null, 42, "a".repeat(2001)])(
    "rejects invalid input without provider call",
    async (message) => {
      const mock = provider();
      const { db } = database();
      expect((await onRequestPost(context(db, message))).status).toBe(400);
      expect(mock).not.toHaveBeenCalled();
    },
  );
  it("rejects oversized streamed requests", async () => {
    const mock = provider();
    const { db } = database();
    expect((await onRequestPost(context(db, "a".repeat(17000)))).status).toBe(400);
    expect(mock).not.toHaveBeenCalled();
  });
  it.each([429, 500])(
    "falls back on provider HTTP %i without writing a profile",
    async (status) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status }));
      const { db, writes } = database();
      const response = await onRequestPost(context(db, "こんにちは", "verified"));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(Object.keys(body).sort()).toEqual(["cocktailCard", "emotion", "message"]);
      expect([...body.message].length).toBeGreaterThanOrEqual(80);
      expect([...body.message].length).toBeLessThanOrEqual(120);
      expect(writes).toEqual([]);
    },
  );
  it.each([
    "not json",
    JSON.stringify({ ...valid, emotion: "invalid" }),
    JSON.stringify({ ...valid, message: "短い" }),
  ])("falls back on invalid output", async (content) => {
    provider(content);
    const { db, writes } = database();
    expect((await (await onRequestPost(context(db))).json()).emotion).toBe("warm");
    expect(writes).toEqual([]);
  });
  it("handles refusal and truncation", async () => {
    provider(JSON.stringify(valid), { finish_reason: "length" });
    const { db } = database();
    expect((await (await onRequestPost(context(db))).json()).cocktailCard).toBeNull();
  });
  it("handles an explicit provider refusal", async () => {
    provider("", { message: { content: null, refusal: "refused" } });
    const { db, writes } = database();
    expect((await (await onRequestPost(context(db))).json()).emotion).toBe("warm");
    expect(writes).toEqual([]);
  });
  it("rejects unknown authenticated users before calling OpenAI", async () => {
    const { db } = database();
    vi.spyOn(db, "prepare").mockReturnValue({
      bind() {
        return this;
      },
      async first() {
        return null;
      },
      async all() {
        return { results: [] };
      },
      async run() {
        return {};
      },
    });
    const mock = provider();
    expect((await onRequestPost(context(db, "こんにちは", "missing"))).status).toBe(401);
    expect(mock).not.toHaveBeenCalled();
  });
  it("does not call OpenAI on D1 failure", async () => {
    const { db } = database();
    vi.spyOn(db, "prepare").mockImplementation(() => {
      throw new Error("D1 unavailable");
    });
    const mock = provider();
    expect((await (await onRequestPost(context(db))).json()).emotion).toBe("warm");
    expect(mock).not.toHaveBeenCalled();
  });
  it("handles network timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    const { db } = database();
    expect((await (await onRequestPost(context(db))).json()).emotion).toBe("warm");
  });
  it("fails closed on missing configuration", async () => {
    const mock = provider();
    expect((await onRequestPost({ request: context(database().db).request, env: {} })).status).toBe(
      503,
    );
    expect(mock).not.toHaveBeenCalled();
  });
});
