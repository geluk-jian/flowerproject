import { buildGuide } from "./getFlowerGuide.js";

function isSameOrigin(candidate, origin) {
  if (!candidate) return false;
  try {
    return new URL(candidate).origin === origin;
  } catch {
    return false;
  }
}

function corsHeadersFor(req) {
  const requestUrl = new URL(req.url);
  const requestOrigin = requestUrl.origin;
  const originHeader = req.headers.get("Origin");
  const allowedOrigin = isSameOrigin(originHeader, requestOrigin) ? originHeader : requestOrigin;
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function createRid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `rid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAccessToken(apiKey, apiSecret) {
  const res = await fetch("https://api.iamport.kr/users/getToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imp_key: apiKey,
      imp_secret: apiSecret,
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.code !== 0 || !data?.response?.access_token) {
    throw new Error(
      `portone_token_failed:${res.status}:${data?.message || data?.code || "unknown"}`
    );
  }

  return data.response.access_token;
}

async function getPayment(accessToken, impUid) {
  const res = await fetch(`https://api.iamport.kr/payments/${encodeURIComponent(impUid)}`, {
    method: "GET",
    headers: {
      Authorization: accessToken,
    },
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.code !== 0 || !data?.response) {
    throw new Error(
      `portone_payment_lookup_failed:${res.status}:${data?.message || data?.code || "unknown"}`
    );
  }

  return data.response;
}

async function getPaymentByMerchantUid(accessToken, merchantUid) {
  const res = await fetch(
    `https://api.iamport.kr/payments/find/${encodeURIComponent(merchantUid)}/paid`,
    {
      method: "GET",
      headers: {
        Authorization: accessToken,
      },
    }
  );

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.code !== 0 || !data?.response) {
    throw new Error(
      `portone_payment_lookup_by_merchant_uid_failed:${res.status}:${data?.message || data?.code || "unknown"}`
    );
  }

  return data.response;
}

async function getPaymentWithFallback(accessToken, impUid, merchantUid) {
  try {
    return await getPayment(accessToken, impUid);
  } catch (error) {
    const message = String(error?.message || "");
    if (!message.startsWith("portone_payment_lookup_failed:404:")) {
      throw error;
    }
  }

  // 결제 완료 직후에는 imp_uid 단건조회가 잠깐 404일 수 있어 merchant_uid 기준으로 재시도합니다.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      await sleep(700);
    }
    try {
      return await getPaymentByMerchantUid(accessToken, merchantUid);
    } catch (fallbackError) {
      const fallbackMessage = String(fallbackError?.message || "");
      if (
        attempt === 2 ||
        !fallbackMessage.startsWith("portone_payment_lookup_by_merchant_uid_failed:404:")
      ) {
        throw fallbackError;
      }
    }
  }

  throw new Error("portone_payment_lookup_failed:404:payment_not_found_after_fallback");
}

export async function onRequest(context) {
  const { request, env } = context;
  const cors = corsHeadersFor(request);
  const requestUrl = new URL(request.url);
  const requestOrigin = requestUrl.origin;
  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");
  const originAllowed =
    !originHeader ||
    isSameOrigin(originHeader, requestOrigin) ||
    isSameOrigin(refererHeader, requestOrigin);

  if (request.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
  if (!originAllowed) return json({ error: "forbidden_origin" }, 403, cors);

  if (!env?.PORTONE_API_KEY || !env?.PORTONE_API_SECRET) {
    return json({ error: "missing_portone_credentials" }, 500, cors);
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400, cors);
  }

  const impUid = String(body?.imp_uid || "").trim();
  const merchantUid = String(body?.merchant_uid || "").trim();
  const expectedAmount = toNumber(body?.expectedAmount);

  if (!impUid || !merchantUid || !expectedAmount) {
    return json({ error: "missing_payment_fields" }, 400, cors);
  }

  try {
    const accessToken = await getAccessToken(env.PORTONE_API_KEY, env.PORTONE_API_SECRET);
    const payment = await getPaymentWithFallback(accessToken, impUid, merchantUid);

    if (String(payment?.merchant_uid || "").trim() !== merchantUid) {
      return json({ error: "merchant_uid_mismatch" }, 400, cors);
    }

    if (String(payment?.status || "").trim() !== "paid") {
      return json({ error: "payment_not_paid", status: payment?.status || null }, 400, cors);
    }

    if (toNumber(payment?.amount) !== expectedAmount) {
      return json(
        {
          error: "amount_mismatch",
          expectedAmount,
          paidAmount: toNumber(payment?.amount),
        },
        400,
        cors
      );
    }

    const result = await buildGuide(body, env);
    const rid = createRid();
    const savedAt = new Date().toISOString();

    if (env?.RESULTS_KV) {
      await env.RESULTS_KV.put(
        `paid:${rid}`,
        JSON.stringify({
          rid,
          savedAt,
          result,
          meta: {
            imp_uid: impUid,
            merchant_uid: merchantUid,
            amount: expectedAmount,
            status: payment.status,
            pg_provider: payment.pg_provider || null,
            pay_method: payment.pay_method || null,
          },
        })
      );
    }

    return json(
      {
        ok: true,
        rid,
        savedAt,
        result,
        payment: {
          imp_uid: impUid,
          merchant_uid: merchantUid,
          amount: expectedAmount,
          status: payment.status,
        },
      },
      200,
      cors
    );
  } catch (error) {
    return json(
      {
        error: "payment_verification_failed",
        detail: String(error?.message || "unknown_error"),
      },
      500,
      cors
    );
  }
}
