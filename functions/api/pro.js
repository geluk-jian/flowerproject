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

function normalizeStr(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function buildCacheKey(body) {
  // 같은 입력이면 같은 키가 되게 (필요한 값만 포함)
  const payload = {
    prompt: normalizeStr(body?.prompt),
    freeText: normalizeStr(body?.free_text || body?.freeText),
    mainFlower: normalizeStr(body?.mainFlower),
    paletteKey: normalizeStr(body?.paletteKey),
    input: body?.input ?? null,
    images: (Array.isArray(body?.images) ? body.images : [])
      .filter((v) => typeof v === "string" && v.trim())
      .map((v) => v.trim()),
  };
  const raw = JSON.stringify(payload);
  const hash = await sha256Hex(raw);
  return `pro:v1:${hash}`;
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

async function generateBouquetImage({ apiKey, text, prompt, mainFlower, paletteKey }) {
  const key = String(paletteKey || "").trim().toLowerCase() || "pink_peach";

  const SETS = {
    pink_peach: {
      label: "pink-peach",
      mood: "elegant, romantic, soft",
      focal: ["rose", "lisianthus"],
      secondary: ["spray roses", "small carnations"],
      filler: "waxflower",
      greenery: ["eucalyptus", "ruscus"],
      bg: "light gray seamless backdrop with subtle gradient",
    },
    yellow_orange: {
      label: "yellow-orange",
      mood: "bright, cheerful, clean",
      focal: ["tulips", "roses"],
      secondary: ["spray roses", "lisianthus"],
      filler: "solidago",
      greenery: ["eucalyptus", "pittosporum"],
      bg: "light gray seamless backdrop with subtle gradient",
    },
    red_wine: {
      label: "deep red / burgundy",
      mood: "moody, chic, luxurious",
      focal: ["deep red roses", "ranunculus"],
      secondary: ["deep red spray roses", "small carnations"],
      filler: "hypericum berries",
      greenery: ["ruscus", "eucalyptus"],
      bg: "light gray seamless backdrop with subtle gradient",
    },
    white_green: {
      label: "white-green",
      mood: "minimal, clean, modern",
      focal: ["white roses", "white lisianthus"],
      secondary: ["spray roses"],
      filler: "baby's breath",
      greenery: ["eucalyptus", "ruscus"],
      bg: "light gray seamless backdrop with subtle gradient",
    },
    lilac: {
      label: "lilac / lavender",
      mood: "elegant, dreamy, refined",
      focal: ["purple lisianthus", "roses"],
      secondary: ["spray roses"],
      filler: "statice",
      greenery: ["eucalyptus", "ruscus"],
      bg: "light gray seamless backdrop with subtle gradient",
    },
  };

  const set = SETS[key] || SETS.pink_peach;

  const mf = String(mainFlower || "").trim();
  const mainRule = mf
    ? `Include "${mf}" as ONE of the focal blooms (medium size), not oversized, mixed with another focal flower.`
    : "No single oversized centerpiece; keep focal blooms medium and balanced.";

  // 이미지용 스펙(짧고 명확하게) — text 전체를 넣지 않음(혼란 방지)
  const shortConcept = [
    "Korean florist bouquet, premium realistic studio product photo.",
    `Color palette: ${set.label}. Mood: ${set.mood}.`,
    "Balanced multi-flower bouquet: 3 medium focal blooms + 6-10 secondary blooms + 1 filler + 1-2 airy greenery types.",
    `Focal: ${set.focal.join(" + ")} (mixed, similar size).`,
    `Secondary: ${set.secondary.join(" + ")}.`,
    `Filler: ${set.filler}.`,
    `Greenery: ${set.greenery.join(" + ")}.`,
    mainRule,
  ].join("\n");

  const photoRules = [
    "Photorealistic studio product photography of a florist-designed hand-tied bouquet.",
    "Single bouquet centered, no text, no watermark, no logo, no people, no hands.",
    "Real paper wrap with subtle wrinkles and micro texture, satin ribbon.",
    `Softbox lighting, natural soft shadow on ${set.bg}.`,
    "85mm lens look, shallow depth of field, subtle film grain, high detail.",
    "Negative: no CGI, no 3D render, no illustration, avoid perfect symmetry, avoid plastic/waxy petals, avoid one giant central bloom dominating the bouquet.",
  ].join("\n");

  const imagePrompt = `${shortConcept}\n\n${photoRules}`;

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
        quality: "medium",
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
  const mainFlower = String(body?.mainFlower || "").trim();
  const paletteKey = String(body?.paletteKey || "").trim();
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

  // ===== KV cache lookup (before OpenAI calls) =====
  const kv = context.env.FLOWER_CACHE; // 바인딩 이름 그대로
  let cacheKey = null;

  if (kv) {
    cacheKey = await buildCacheKey(body);
    const cached = await kv.get(cacheKey, { type: "json" });
    if (cached?.text && cached?.image_url) {
      return new Response(
        JSON.stringify({
          text: cached.text,
          image_url: cached.image_url,
          cached: true,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  }

  const buildInput = () => {
    if (input) return input;
    const freeText = String(body?.free_text || body?.freeText || "").trim();
    const images = Array.isArray(body?.images) ? body.images : [];
    const systemText = [
      "당신은 10년차 플로리스트입니다. 아래 \"무료 설문 결과/사용자 입력\"을 바탕으로,",
      "화이트데이(또는 선물 상황)에서 실패하지 않는 '구매 실행형' 추천서를 작성하세요.",
      "과장 금지, 현실적으로 꽃집에서 바로 통하는 문장만 씁니다.",
      "출력은 반드시 아래 형식/순서를 지키고, 각 항목은 2~5줄로 간결하게.",
      "",
      "[출력 형식]",
      "1) 한줄 결론(그냥 이대로 사면 됨)",
      "- 예: \"핑크-피치 톤의 우아한 믹스 부케 / 과하지 않게 고급 포장\"",
      "",
      "2) 꽃다발 구성(조화로운 구성 규칙)",
      "- 포컬(중간 크기) 3송이: (꽃 2종 혼합, '한 송이만 크게' 금지)",
      "- 서브 6~10송이: (작은 꽃/스프레이류)",
      "- 필러 1종: (작은 군락)",
      "- 그린 1~2종: (공기감)",
      "※ 팔레트/무드/관계에 맞춰 꽃을 구체적으로 제안.",
      "",
      "3) 예산별 추천(3만/5만/7만 중 해당만 강조)",
      "- 같은 톤 유지하면서 \"볼륨/포인트/포장\"만 단계적으로 업그레이드.",
      "",
      "4) 꽃집 주문서(복붙 1개: 가장 중요)",
      "- 꽃집 사장님에게 그대로 보내도 되는 완성 문장 1개.",
      "- 포함해야 할 요소: 예산 / 팔레트 / 무드 / 포컬·서브·그린 구성 / 포장지·리본 톤 / 금지사항 1개.",
      "",
      "5) 카드 한줄(남자가 쓰기 쉬운 문장 2개)",
      "- 길고 감성적인 문구 금지. 짧고 안전한 문장 2개.",
      "",
      "6) 피해야 할 실수 3가지(짧게)",
      "- 예: \"너무 쨍한 색 섞기 / 장례 느낌 톤 / 포장 과하게 번쩍이는 것\"",
      "",
      "[작성 규칙]",
      "- '계절/재고에 따라 유사 소재로 대체 가능' 한 줄 추가.",
      "- 너무 완벽하게 꾸며진 말투 금지. 실제 주문/실행 중심.",
      "- 꽃 이름은 한국 꽃집에서 통하는 표현으로(예: 장미, 스프레이장미, 리시안셔스, 튤립, 유칼립 등).",
    ].join("\n");

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
  const image_url = await generateBouquetImage({ apiKey, text, prompt, mainFlower, paletteKey });

  // ===== KV cache save (only on success) =====
  if (kv && cacheKey && text && image_url) {
    await kv.put(cacheKey, JSON.stringify({ text, image_url }), {
      expirationTtl: 60 * 60 * 24 * 14, // 14일
    });
  }

  return new Response(JSON.stringify({ text, image_url }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
