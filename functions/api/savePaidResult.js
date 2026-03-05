// functions/api/savePaidResult.js
// POST /api/savePaidResult
// body: { result: <유료결과JSON>, meta?: <선택값 등> }

export async function onRequest(context) {
  const { request, env } = context;
  const requestUrl = new URL(request.url);
  const requestOrigin = requestUrl.origin;
  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");
  const allowedOrigin = isSameOrigin(originHeader, requestOrigin)
    ? originHeader
    : requestOrigin;
  const originAllowed =
    !originHeader ||
    isSameOrigin(originHeader, requestOrigin) ||
    isSameOrigin(refererHeader, requestOrigin);
  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };

  if (request.method === "OPTIONS") return new Response("", { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, corsHeaders);
  if (!originAllowed) return json({ error: "forbidden_origin" }, 403, corsHeaders);

  if (!env?.RESULTS_KV) {
    return json(
      { error: "missing_kv_binding", hint: "KV binding name must be RESULTS_KV" },
      500,
      corsHeaders
    );
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400, corsHeaders);
  }

  const result = body?.result;
  if (!result || typeof result !== "object") {
    return json({ error: "result_required" }, 400, corsHeaders);
  }

  // 최소 키 체크(너 renderVipResult가 쓰는 핵심)
  const requiredKeys = ["imageUrl", "orderText", "palettes", "messages", "meaning"];
  const missing = requiredKeys.filter((k) => !(k in result));
  if (missing.length) return json({ error: "result_missing_keys", missing }, 400, corsHeaders);

  // 과도한 저장 방지(대략 200KB)
  const serialized = JSON.stringify(result);
  if (serialized.length > 200_000) {
    return json({ error: "payload_too_large" }, 413, corsHeaders);
  }

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

  return json({ ok: true, rid, viewUrl }, 200, corsHeaders);
}

function isSameOrigin(candidate, origin) {
  if (!candidate) return false;
  try {
    return new URL(candidate).origin === origin;
  } catch {
    return false;
  }
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}
