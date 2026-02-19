const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response("", { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/api/pro") {
      return new Response("Not found", { status: 404, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    let body = null;
    try {
      body = await request.json();
    } catch (e) {}

    const prompt = String(body?.prompt || "").trim();
    if (!prompt) {
      return jsonResponse({ error: "prompt_required" }, 400);
    }

    if (!env.OPENAI_API_KEY) {
      return jsonResponse({ error: "missing_openai_api_key" }, 500);
    }

    const payload = {
      model: "gpt-4.1-mini",
      input: prompt,
      max_output_tokens: 500,
    };

    let upstream;
    try {
      upstream = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return jsonResponse({ error: "upstream_fetch_failed" }, 502);
    }

    let data = null;
    try {
      data = await upstream.json();
    } catch (e) {}

    if (!upstream.ok) {
      return jsonResponse(
        { error: "openai_error", status: upstream.status, details: data || null },
        upstream.status
      );
    }

    return jsonResponse({ text: data?.output_text || "" });
  },
};
