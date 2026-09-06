import { AppError } from "./errors";
import { ensureBudgetRows } from "./store";
async function readLimitedJson(response: Response) {
  if (!response.body)
    throw new AppError(
      "empty_provider_response",
      "The story editor returned an empty response.",
      503,
    );
  const reader = response.body.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 128 * 1024) {
      await reader.cancel();
      throw new AppError(
        "provider_response_large",
        "The story editor returned too much data.",
        503,
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as {
    choices?: { message?: { content?: string } }[];
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
}
// Shared by scene preview, continuity recheck and post-publication archives.
// Deterministic archive IDs prevent a restarted workflow from repeating a paid request.
export async function callEditor(
  env: Cloudflare.Env,
  task: { id: string; user_id: string },
  kind: string,
  rules: string,
  context: unknown,
  callId: string = crypto.randomUUID(),
): Promise<string> {
  if (String(env.PROVIDER_MODE) !== "live" || !env.DIRECTOR_API_KEY)
    throw new AppError(
      "editor_unavailable",
      "The story editor is not connected. Published scenes remain available.",
      503,
    );
  if (new TextEncoder().encode(JSON.stringify(context)).byteLength > 100_000)
    throw new AppError(
      "editor_context_large",
      "This archive needs a smaller reviewed context before it can be generated.",
      409,
    );
  const { day, month } = await ensureBudgetRows(env, task.user_id);
  await env.DB.prepare(
    "INSERT INTO model_calls(id,task_id,day,month,cost_ceiling_cents,kind,created_at) VALUES(?,?,?,?,25,?,?)",
  )
    .bind(callId, task.id, day, month, kind, Date.now())
    .run();
  const endpoint = new URL(env.DIRECTOR_API_URL);
  if (endpoint.protocol !== "https:")
    throw new AppError(
      "provider_configuration",
      "The story editor is not configured correctly.",
      503,
    );
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${env.DIRECTOR_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.DIRECTOR_MODEL,
      messages: [
        { role: "system", content: rules },
        { role: "user", content: JSON.stringify(context) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 4000,
      ...(endpoint.hostname === "api.deepseek.com"
        ? { thinking: { type: "disabled" } }
        : {}),
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok)
    throw new AppError(
      "director_failed",
      "The story editor could not finish. Your idea is saved.",
      503,
    );
  const data = await readLimitedJson(response),
    content = data.choices?.[0]?.message?.content;
  if (!content)
    throw new AppError(
      "director_failed",
      "The story editor returned no scene plan.",
      503,
    );
  const tokens = (n: unknown) =>
    typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
  await env.DB.prepare(
    "UPDATE model_calls SET status='completed',provider_model=?,input_tokens=?,output_tokens=? WHERE id=?",
  )
    .bind(
      typeof data.model === "string" ? data.model.slice(0, 120) : null,
      tokens(data.usage?.prompt_tokens),
      tokens(data.usage?.completion_tokens),
      callId,
    )
    .run();
  return content;
}
