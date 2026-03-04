// functions/api/getFlowerGuide.js

const paletteMap = {
  white_green: {
    label: "화이트·그린",
    colors: [
      { hex: "#F8F7F2", name: "Ivory" },
      { hex: "#D9D9D6", name: "Mist" },
      { hex: "#C9D4C5", name: "Sage" },
    ],
  },
  pink_peach: {
    label: "핑크·피치",
    colors: [
      { hex: "#F7CAC9", name: "Blush" },
      { hex: "#F7B39B", name: "Peach" },
      { hex: "#F3E0BE", name: "Cream" },
    ],
  },
  lilac: {
    label: "연보라·라일락",
    colors: [
      { hex: "#E6D9F2", name: "Lilac" },
      { hex: "#C7B6E6", name: "Lavender" },
      { hex: "#9B84C9", name: "Iris" },
    ],
  },
  red_wine: {
    label: "레드·버건디",
    colors: [
      { hex: "#C94C5B", name: "Rose" },
      { hex: "#8B1E3F", name: "Wine" },
      { hex: "#F3D5DB", name: "Blush" },
    ],
  },
  yellow_orange: {
    label: "옐로·오렌지",
    colors: [
      { hex: "#FFD23F", name: "Sun" },
      { hex: "#FF8C42", name: "Tangerine" },
      { hex: "#FFE9CC", name: "Vanilla" },
    ],
  },
};

function normalizeCode(v) {
  return String(v || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function isValidVipCode(env, rawCode) {
  const input = normalizeCode(rawCode);
  if (!input) return false;

  const list = String(env?.VIP_CODES || "")
    .split(",")
    .map((s) => normalizeCode(s))
    .filter(Boolean);

  return list.includes(input);
}

function corsHeadersFor(req) {
  const origin = req.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// ✅ fallback 로컬 이미지(최소한 이 정도는 있어야 안전)
const flowerImgByKey = {
  rose: "/image/rose.png",
  calla: "/image/calla.png",
  gerbera: "/image/gerbera.png",
  lisianthus: "/image/lisianthus.png",
  tulip: "/image/tulip.png",
  ranunculus: "/image/ranunculus.png",
  carnation: "/image/carnation.png",
  hydrangea: "/image/hydrangea.png",
};

async function generateBouquetImageBase64({ apiKey, prompt }) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-1-mini",
      prompt,
      size: "1024x1024",
      quality: "low",
      n: 1,
      output_format: "png",
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`image_generation_failed: ${res.status} ${t}`);
  }

  const json = await res.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error("image_generation_no_b64");
  return `data:image/png;base64,${b64}`;
}

export async function onRequest(context) {
  const { request, env } = context;
  const cors = corsHeadersFor(request);

  if (request.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400, cors);
  }

  if (!isValidVipCode(env, body.vipCode)) {
    return json({ error: "vip_code_required_or_invalid" }, 403, cors);
  }

  const guide = await buildGuide(body, env);
  return json(guide, 200, cors);
}

/**
 * ✅ 프론트(renderVipResult)가 기대하는 키:
 * imageUrl, targetName, moodLabel, orderText, wrapGuide, flowerMix, palettes, messages, priceInfo, meaning
 */
async function buildGuide(body, env) {
  const relationRaw = String(body?.relation ?? "상대").trim();
  const occasionRaw = String(body?.occasion ?? "선물").trim();
  const styleKey = String(body?.style ?? "chic_elegant").trim();
  const paletteKey = String(body?.palette ?? "white_green").trim();
  const photoHabitKey = String(body?.photoHabit ?? "sns_sometimes").trim();
  const mainFlower = String(body?.mainFlower ?? "").trim();
  const mainFlowerKey = String(body?.mainFlowerKey ?? "").trim();
  const rawCautions = Array.isArray(body?.cautions) ? body.cautions : [];

  const styleLabelMap = {
    soft_feminine: "청순/여리",
    romantic: "러블리",
    chic_elegant: "세련/우아",
    trendy: "트렌디/힙",
    minimal: "미니멀/깔끔",
  };
  const photoHabitLabelMap = {
    sns_often: "SNS 자주 올림",
    sns_sometimes: "가끔 올림",
    private_photo: "찍고 보관",
    no_photo: "사진 관심 없음",
  };
  const cautionLabelMap = {
    scent_light: "향은 약한 쪽",
    allergy_sensitive: "알레르기/민감",
    no_rose: "장미 제외",
    clean_over_flashy: "화려함보다 깔끔",
    none: "없음",
  };

  const styleLabel = styleLabelMap[styleKey] || "세련/우아";
  const photoHabitLabel = photoHabitLabelMap[photoHabitKey] || "가끔 올림";

  const cautionsShort = rawCautions
    .map((v) => cautionLabelMap[v] || String(v))
    .filter((v) => v && v !== "없음" && v !== "none")
    .slice(0, 4);

  const paletteMeta = paletteMap[paletteKey] || {
    label: "내추럴",
    colors: [
      { hex: "#EDE7DF", name: "Oat" },
      { hex: "#D2C4B2", name: "Sand" },
      { hex: "#A9B8A0", name: "Moss" },
    ],
  };

  // ✅ 포장 가이드: Q6 + 팔레트 + 스타일 반영
  const wrapByPhoto = {
    sns_often: "포인트 컬러 포장 + 리본 포인트(사진발 우선)",
    sns_sometimes: "톤다운 포장 + 리본 1개(무난하고 예쁘게)",
    private_photo: "무광/차분 포장 + 리본 최소(깔끔하게)",
    no_photo: "크래프트/심플 포장 + 리본 최소(담백하게)",
  };
  const wrapToneByPalette = {
    white_green: "화이트/오프화이트 포장지(무광) + 그린 포인트",
    pink_peach: "오프화이트/연핑크 포장지 + 얇은 리본",
    lilac: "오프화이트/연보라 포장지 + 톤다운 리본",
    red_wine: "오프화이트/크림 포장지 + 버건디 리본(과하지 않게)",
    yellow_orange: "오프화이트/크림 포장지 + 옐로 포인트(절제)",
  };
  const wrapFinishByStyle = {
    soft_feminine: "부드러운 레이어 1장(과장 금지)",
    romantic: "리본은 얇게(톤온톤), 과한 프릴 금지",
    chic_elegant: "무광 종이 + 각 잡힌 마감(정돈)",
    trendy: "포인트는 한 색만(과함 금지)",
    minimal: "장식 최소, 리본 0~1개",
  };

  const wrapGuide = [
    wrapByPhoto[photoHabitKey] || wrapByPhoto.sns_sometimes,
    wrapToneByPalette[paletteKey] || "오프화이트/크림 계열 포장지",
    wrapFinishByStyle[styleKey] || "무광 종이 + 정돈된 마감",
  ].join(" / ");

  // ✅ 가격 추천(상황/관계/사진습관 반영)
  function recommendBudgetAndSize() {
    const relation = relationRaw;
    const occasion = occasionRaw;

    let size = "M";
    let budget = "약 5만 ~ 8만 원";
    let reason = "대부분 상황에서 무난하고 실패 확률이 낮은 크기";

    const isSome = relation.includes("썸") || relation.includes("소개팅");
    const isPartner = relation.includes("여자친구") || relation.includes("연인");
    const isSpouse = relation.includes("아내") || relation.includes("배우자");
    const isFriendCoworker = relation.includes("친구") || relation.includes("동료");

    const isBday = occasion.includes("생일") || occasion.includes("기념일");
    const isCongrats =
      occasion.includes("축하") ||
      occasion.includes("합격") ||
      occasion.includes("승진") ||
      occasion.includes("새출발");
    const isSorry = occasion.includes("미안") || occasion.includes("사과");
    const isFirst = occasion.includes("처음");

    if (isSome || isSorry || isFirst) {
      size = "S";
      budget = "약 3만 ~ 5만 원";
      reason = "부담 없이 주기 좋은 안전한 구간";
    }

    if (isFriendCoworker && isCongrats) {
      size = "M";
      budget = "약 5만 ~ 8만 원";
      reason = "축하 분위기 + 적당한 존재감";
    }

    if ((isPartner || isSpouse) && isBday) {
      size = "L";
      budget = "약 8만 ~ 13만 원";
      reason = "기념일은 ‘확실한 선물’ 느낌이 나야 만족도가 높음";
    }

    // SNS 자주면 한 단계 업(사진발)
    if (photoHabitKey === "sns_often") {
      if (size === "S") {
        size = "M";
        budget = "약 5만 ~ 8만 원";
        reason = "사진에 예쁘게 남기려면 볼륨이 필요";
      } else if (size === "M" && (isPartner || isSpouse || isBday)) {
        size = "L";
        budget = "약 8만 ~ 13만 원";
        reason = "SNS 업로드 시 ‘선물 값’이 보이게 나오는 구간";
      }
    }

    return {
      size,
      budget,
      reason,
      table: {
        S: "3만~5만 (가벼운 감사/첫 선물/사과)",
        M: "5만~8만 (친한 친구/축하/무난)",
        L: "8만~13만 (각별한 사이/기념일)",
      },
    };
  }

  const priceRec = recommendBudgetAndSize();

  // ✅ 꽃 조합(스타일/주의 반영)
  function buildFlowerMix() {
    const main = mainFlower || "시즌 메인 꽃(꽃집 추천)";
    let sub = "알스트로메리아(톤 맞춤) 또는 스프레이 플라워";
    let filler = "유칼립투스/그린(가볍게)";

    if (styleKey === "minimal" || styleKey === "chic_elegant") {
      sub = "리시안셔스/스카비오사 등 톤다운 서브(과한 색 금지)";
      filler = "러스커스/유칼립투스 소량(정돈)";
    }
    if (styleKey === "romantic" || styleKey === "soft_feminine") {
      sub = "스프레이 카네이션/왁스플라워 등 부드러운 필러";
      filler = "유칼립투스/그린(부드럽게)";
    }
    if (styleKey === "trendy") {
      sub = "포인트 1개만(톤 맞춰서) / 형태감 있는 꽃 1종";
      filler = "그린은 선 정리용으로만(과다 금지)";
    }

    if (cautionsShort.includes("알레르기/민감") || cautionsShort.includes("향은 약한 쪽")) {
      filler = "그린은 최소(또는 무향 그린)로 / 꽃가루 적은 쪽";
    }
    if (cautionsShort.includes("장미 제외")) {
      sub = sub.replace(/스프레이/gi, "");
    }

    return [
      `메인: ${main}`,
      `서브: ${sub}`,
      `그린/필러: ${filler}`,
      "대체 규칙: 메인 꽃이 없으면 ‘같은 무드/같은 톤’의 시즌 꽃으로 대체(색만 유지)",
    ].join("\n");
  }

  const flowerMix = buildFlowerMix();

  // ✅ 멘트 5개(상황 반영)
  function buildMessages() {
    const who = relationRaw;
    const occasion = occasionRaw;

    const base = [
      `${who} 생각나서 이 느낌으로 골라봤어.`,
      `부담 없이 받아줘. ${who}한테 잘 어울릴 것 같았어.`,
      `오늘은 ${who} 기분 좋아졌으면 해서 준비했어.`,
      `${occasion}이라 그냥 지나치기 싫었어.`,
      "꽃처럼 예쁜 하루 보내 🙂",
    ];

    if (occasion.includes("미안") || occasion.includes("사과")) {
      base[0] = "미안해. 말로만 하지 않고 진심으로 전하고 싶었어.";
      base[3] = "내가 더 잘할게. 오늘은 마음 풀렸으면 좋겠다.";
    }
    if (occasion.includes("축하") || occasion.includes("합격") || occasion.includes("승진")) {
      base[2] = "진짜 멋졌다. 이렇게 축하하고 싶었어.";
    }

    return base;
  }

  const messages = buildMessages();

  // ✅ 무드 라벨(남성용 이해 쉬운 태그)
  function buildMoodLabel() {
    const paletteTag = {
      white_green: "깔끔/정돈/미니멀",
      pink_peach: "부드러움/러블리/호감",
      lilac: "차분/감성/세련",
      red_wine: "로맨틱/포인트/확실",
      yellow_orange: "밝음/활기/응원",
    }[paletteKey] || "내추럴";

    const styleTag = {
      soft_feminine: "맑고 여리한",
      romantic: "달콤하고 사랑스러운",
      chic_elegant: "도시적이고 정돈된",
      trendy: "감각적이고 쿨한",
      minimal: "담백하고 절제된",
    }[styleKey] || "정돈된";

    return `${styleTag} / ${paletteTag}`;
  }

  const moodLabel = `${paletteMeta.label} · ${buildMoodLabel()}`;

  const cautionLine = cautionsShort.length
    ? `주의: ${cautionsShort.join(" · ")}`
    : "주의: 너무 화려하지 않게, 과하지 않게";

  // ✅ 꽃집 복붙 주문서(불안 해소용)
  const orderText = [
    `[예산/사이즈] ${priceRec.size} / ${priceRec.budget} (이유: ${priceRec.reason})`,
    `[상황] ${relationRaw}에게 ${occasionRaw} 선물`,
    `[메인 꽃] ${mainFlower ? `"${mainFlower}" 꼭 포함` : "꽃집 추천 메인꽃 1종 중심"}`,
    `[무드/색] ${moodLabel} / ${paletteMeta.label} 톤 중심`,
    `[포장] ${wrapGuide}`,
    `[사진] ${photoHabitLabel} → 사진에 디테일이 잘 보이게 정돈`,
    `[구성] ${styleLabel} 무드로 ‘깔끔하게’, 포인트 꽃 1~2개만`,
    `[대체] 재고 없으면 같은 톤/무드로 대체(톤 유지)`,
    cautionLine,
  ].join("\n");

  // ✅ 이미지 프롬프트(Q값 반영)
  const paletteLine = (paletteMeta.colors || [])
    .map((c) => `${c.name} (${c.hex})`)
    .join(", ");

  const imagePrompt = [
    "Premium realistic product photo of a single Korean florist bouquet.",
    "Bouquet centered, clean cream studio background, soft natural light.",
    "NO people, NO hands, NO text, NO watermark, NO logo.",
    mainFlower
      ? `Main flower must be clearly visible and dominant: ${mainFlower}.`
      : "Main flower must be clearly visible and dominant.",
    `Color palette: ${paletteMeta.label}. Use these colors: ${paletteLine}.`,
    `Style/mood: ${styleLabel}.`,
    `Wrapping: ${wrapGuide}.`,
    "High detail, natural petals and greenery, premium florist look.",
    cautionsShort.includes("알레르기/민감") ? "Avoid pollen-heavy look; keep clean petals." : "",
  ]
    .filter(Boolean)
    .join("\n");

  // ✅ 이미지 생성(실패해도 로컬 이미지로 무조건 fallback)
  let imageUrl = "";
  try {
    const apiKey = env?.OPENAI_API_KEY;
    if (apiKey) {
      imageUrl = await generateBouquetImageBase64({ apiKey, prompt: imagePrompt });
    }
  } catch {
    // ignore
  }
  if (!imageUrl) {
    imageUrl = flowerImgByKey[mainFlowerKey] || "/image/rose.png";
  }

  const meaning = (() => {
    if (mainFlower.includes("장미")) return "호감/애정 표현에 무난한 선택";
    if (mainFlower.includes("카네이션")) return "감사/존중을 담기 쉬운 선택";
    if (mainFlower.includes("튤립")) return "깔끔하고 설레는 분위기를 만들기 쉬움";
    if (mainFlower.includes("수국")) return "볼륨감과 사진발에 유리";
    if (mainFlower.includes("카라") || mainFlower.includes("칼라")) return "세련되고 도시적인 인상";
    if (mainFlower.includes("거베라")) return "밝고 기분 좋은 무드";
    if (mainFlower.includes("라넌")) return "러블리/풍성한 무드";
    if (mainFlower.includes("리시안")) return "정돈되고 고급스러운 무드";
    return "선물로 무난한 무드";
  })();

  return {
    __build: "GUIDE-V2.1",
    mainFlower,
    imageUrl,
    targetName: relationRaw,
    moodLabel,
    orderText,
    wrapGuide,
    flowerMix,
    palettes: paletteMeta.colors,
    messages,
    priceInfo: `${priceRec.size} 기준 ${priceRec.budget}`,
    recommend: {
      size: priceRec.size,
      budget: priceRec.budget,
      reason: priceRec.reason,
    },
    priceTable: priceRec.table,
    meaning,
  };
}
