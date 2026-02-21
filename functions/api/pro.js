const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const requestLog = new Map();

function getClientKey(request) {
  const rawForwarded = request.headers.get("x-forwarded-for") || "";
  const forwardedIp = rawForwarded.split(",")[0].trim();
  return (
    request.headers.get("cf-connecting-ip") ||
    forwardedIp ||
    request.headers.get("x-real-ip") ||
    "anonymous"
  );
}

function isRateLimited(clientKey, now = Date.now()) {
  const recent = requestLog.get(clientKey) || [];
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const kept = recent.filter((ts) => ts > windowStart);
  kept.push(now);
  requestLog.set(clientKey, kept);
  return kept.length > RATE_LIMIT_MAX_REQUESTS;
}

function isSameOrigin(candidate, origin) {
  if (!candidate) return false;
  try {
    return new URL(candidate).origin === origin;
  } catch {
    return false;
  }
}

function extractText(responseData) {
  if (!responseData || typeof responseData !== "object") return "";
  if (typeof responseData.output_text === "string" && responseData.output_text.trim()) {
    return responseData.output_text.trim();
  }

  const outputs = Array.isArray(responseData.output) ? responseData.output : [];
  const parts = [];

  for (const item of outputs) {
    const contents = Array.isArray(item?.content) ? item.content : [];
    for (const content of contents) {
      if (typeof content?.text === "string" && content.text.trim()) {
        parts.push(content.text.trim());
      }
    }
  }

  return parts.join("\n\n").trim();
}

async function generateBouquetImage({ apiKey, text, prompt }) {
  const source = String(text || prompt || "").trim().slice(0, 1200);
  if (!source) return null;

  const imagePrompt = [
    "Korean florist bouquet photo, premium realistic style.",
    "Single bouquet centered, clean cream background, soft natural light.",
    "No text, no watermark, no logo, no people, no hands.",
    "Use this concept and mood:",
    source,
  ].join("\n");

  let imageRes;
  try {
    imageRes = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: imagePrompt,
        size: "1024x1024",
      }),
    });
  } catch (e) {
    return null;
  }

  if (!imageRes.ok) return null;

  let imageData = null;
  try {
    imageData = await imageRes.json();
  } catch (e) {
    return null;
  }

  const first = Array.isArray(imageData?.data) ? imageData.data[0] : null;
  if (typeof first?.url === "string" && first.url.trim()) {
    return first.url.trim();
  }
  if (typeof first?.b64_json === "string" && first.b64_json.trim()) {
    return `data:image/png;base64,${first.b64_json.trim()}`;
  }

  return null;
}

export async function onRequestPost(context) {
  const requestUrl = new URL(context.request.url);
  const requestOrigin = requestUrl.origin;
  const originHeader = context.request.headers.get("origin");
  const refererHeader = context.request.headers.get("referer");
  const allowedOrigin = isSameOrigin(originHeader, requestOrigin)
    ? originHeader
    : requestOrigin;
  const originAllowed = !originHeader || isSameOrigin(originHeader, requestOrigin) || isSameOrigin(refererHeader, requestOrigin);

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };

  if (context.request.method === "OPTIONS") {
    return new Response("", { status: 204, headers: corsHeaders });
  }

  if (context.request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!originAllowed) {
    return new Response(JSON.stringify({ error: "forbidden_origin" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (isRateLimited(getClientKey(context.request))) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body = null;
  try {
    body = await context.request.json();
  } catch (e) {}

  const prompt = String(body?.prompt || "").trim();
  const input = Array.isArray(body?.input) ? body.input : null;
  if (!prompt && !input) {
    return new Response(JSON.stringify({ error: "prompt_required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey = context.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "missing_openai_api_key" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const buildInput = () => {
    if (input) return input;
    const freeText = String(body?.free_text || body?.freeText || "").trim();
    const images = Array.isArray(body?.images) ? body.images : [];
    const systemText =
      "당신은 최고의 전문 플로리스트입니다. 무료 설문 결과를 참고해 유료용 디테일 확장 추천서를 작성하세요. " +
      "반드시 다음 구성으로 출력하세요:\n" +
      "1) 꽃다발 이미지 설명(텍스트)\n" +
      "2) 대표꽃/컨셉/이유\n" +
      "3) 상황별 추천 멘트 5개\n" +
      "4) 제작 가이드(톤/포장/조합/대체 규칙)\n" +
      "5) 꽃집 전달용 상세 문장(복붙 1개)\n" +
      "6) 주의/피해야 할 포인트(3개 이내)\n";

    const content = [
      { type: "input_text", text: freeText || prompt },
      ...images
        .filter((v) => typeof v === "string" && v.trim())
        .map((image_url) => ({ type: "input_image", image_url })),
    ];

    return [
      {
        role: "system",
        content: [{ type: "input_text", text: systemText }],
      },
      {
        role: "user",
        content,
      },
    ];
  };

  const payload = {
    model: "gpt-4.1-mini",
    input: buildInput(),
    max_output_tokens: 900,
  };

  let upstream;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000);
  try {
    upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e) {
    if (e && e.name === "AbortError") {
      return new Response(JSON.stringify({ error: "upstream_timeout" }), {
        status: 504,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "upstream_fetch_failed" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    clearTimeout(timeoutId);
  }

  let data = null;
  try {
    data = await upstream.json();
  } catch (e) {}

  if (!upstream.ok) {
    return new Response(
      JSON.stringify({ error: "openai_error", status: upstream.status, details: data || null }),
      {
        status: upstream.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const text = extractText(data);
  const image_url = await generateBouquetImage({ apiKey, text, prompt });

  return new Response(JSON.stringify({ text, image_url }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
