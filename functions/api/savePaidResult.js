// functions/api/savePaidResult.js
// POST /api/savePaidResult
// body: { result: <유료결과JSON>, meta?: <선택값 등> }

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") return new Response("", { status: 204 });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!env?.RESULTS_KV) {
    return json(
      { error: "missing_kv_binding", hint: "KV binding name must be RESULTS_KV" },
      500
    );
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  const result = body?.result;
  if (!result || typeof result !== "object") {
    return json({ error: "result_required" }, 400);
  }

  // 최소 키 체크(너 renderVipResult가 쓰는 핵심)
  const requiredKeys = ["imageUrl", "orderText", "palettes", "messages", "meaning"];
  const missing = requiredKeys.filter((k) => !(k in result));
  if (missing.length) return json({ error: "result_missing_keys", missing }, 400);

  const rid = (globalThis.crypto?.randomUUID)
    ? crypto.randomUUID()
    : `rid_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  // 30일 보관(무료 한도+운영 편의)
  const TTL_SECONDS = 60 * 60 * 24 * 30;

  const payload = {
    rid,
    savedAt: new Date().toISOString(),
    result,
    meta: body?.meta && typeof body.meta === "object" ? body.meta : null,
  };

  await env.RESULTS_KV.put(`paid:${rid}`, JSON.stringify(payload), {
    expirationTtl: TTL_SECONDS,
  });

  const baseUrl = new URL(request.url);
  const viewUrl = `${baseUrl.origin}/guide.html?rid=${encodeURIComponent(rid)}`;

  return json({ ok: true, rid, viewUrl }, 200);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
