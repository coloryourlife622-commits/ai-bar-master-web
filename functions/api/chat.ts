import type { ChatContext } from "../../server/chat/contracts";
import { outputSchema, parseModelOutput, systemPrompt } from "../../server/chat/model";
import type { ChatResponse, CocktailCard } from "../../shared/chat";

const fallback: ChatResponse = {
  message:
    "申し訳ありません、少し考え事をしていました。お話を大切に受け止めたいので、ひと息ついてから、もう一度お聞かせいただけますか。急がず、ご自身のペースでお話しくださいね。",
  emotion: "warm",
  cocktailCard: null,
};
function json(body: ChatResponse, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
export async function onRequestPost({ request, env, data }: ChatContext): Promise<Response> {
  let body: unknown;
  try {
    // Bound the stream, including requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Missing body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        throw new Error("Body too large");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json(
      {
        message: "メッセージを正しいJSON形式でお送りください。",
        emotion: "neutral",
        cocktailCard: null,
      },
      400,
    );
  }
  const message =
    body && typeof body === "object" ? (body as Record<string, unknown>)["message"] : undefined;
  if (typeof message !== "string" || !message.trim() || [...message].length > 2000) {
    return json(
      {
        message: "メッセージは1〜2000文字でお送りください。",
        emotion: "neutral",
        cocktailCard: null,
      },
      400,
    );
  }
  if (!env.DB || !env.OPENAI_API_KEY) return json(fallback, 503);
  try {
    const db = env.DB;
    const userId = data?.userId;
    // No persistent identity is accepted from a client-controlled request field.
    let profile: { summary_text: string; version: number } | null = null;
    if (userId) {
      const user = await db.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
      if (!user)
        return json(
          { message: "ログイン状態をご確認ください。", emotion: "neutral", cocktailCard: null },
          401,
        );
      profile = await db
        .prepare("SELECT summary_text, version FROM user_profiles WHERE user_id = ?")
        .bind(userId)
        .first();
    }
    const { results: cards } = await db
      .prepare(
        `SELECT id, name, phrase, description, image_url AS imageUrl
      FROM cocktails WHERE is_active = 1
      AND (start_at IS NULL OR start_at <= datetime('now'))
      AND (end_at IS NULL OR end_at > datetime('now')) ORDER BY id LIMIT 20`,
      )
      .all<CocktailCard>();
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        max_completion_tokens: 600,
        response_format: {
          type: "json_schema",
          json_schema: { name: "bar_reply", strict: true, schema: outputSchema },
        },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              previousSummary: profile?.summary_text ?? "",
              cocktails: cards,
              message: message.trim(),
            }),
          },
        ],
      }),
    });
    if (!response.ok) return json(fallback);
    const result = (await response.json()) as {
      choices?: {
        finish_reason?: string;
        message?: { content?: string; refusal?: string | null };
      }[];
    };
    const choice = result.choices?.[0];
    if (choice?.finish_reason !== "stop" || choice.message?.refusal || !choice.message?.content)
      return json(fallback);
    const { reply, summary } = parseModelOutput(JSON.parse(choice.message.content), cards);
    if (userId) {
      // Compare-and-swap avoids overwriting a newer summary; a reset/delete never resurrects an existing profile.
      if (profile) {
        await db
          .prepare(
            `UPDATE user_profiles SET summary_text = ?, version = version + 1,
          updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND version = ?`,
          )
          .bind(summary, userId, profile.version)
          .run();
      } else {
        await db
          .prepare(
            `INSERT INTO user_profiles (user_id, summary_text) VALUES (?, ?)
          ON CONFLICT(user_id) DO NOTHING`,
          )
          .bind(userId, summary)
          .run();
      }
    }
    return json(reply);
  } catch {
    // Never log messages, profiles, provider payloads, or API keys.
    return json(fallback);
  }
}
