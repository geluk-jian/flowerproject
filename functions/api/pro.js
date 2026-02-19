export async function onRequestPost(context) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (context.request.method === "OPTIONS") {
    return new Response("", { status: 204, headers: corsHeaders });
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
  try {
    upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "upstream_fetch_failed" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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

  return new Response(JSON.stringify({ text: data?.output_text || "" }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
