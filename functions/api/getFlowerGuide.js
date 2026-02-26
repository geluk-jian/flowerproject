const paletteMap = {
  white_green: {
    label: "화이트·그린",
    colors: [
      { hex: "#F8F7F2", name: "Ivory" },
      { hex: "#D9D9D6", name: "Mist" },
      { hex: "#C9D4C5", name: "Sage" }
    ]
  },
  pink_peach: {
    label: "핑크·피치",
    colors: [
      { hex: "#F7CAC9", name: "Blush" },
      { hex: "#F7B39B", name: "Peach" },
      { hex: "#F3E0BE", name: "Cream" }
    ]
  },
  lilac: {
    label: "연보라·라일락",
    colors: [
      { hex: "#E6D9F2", name: "Lilac" },
      { hex: "#C7B6E6", name: "Lavender" },
      { hex: "#9B84C9", name: "Iris" }
    ]
  },
  red_wine: {
    label: "레드·버건디",
    colors: [
      { hex: "#C94C5B", name: "Rose" },
      { hex: "#8B1E3F", name: "Wine" },
      { hex: "#F3D5DB", name: "Blush" }
    ]
  },
  yellow_orange: {
    label: "옐로·오렌지",
    colors: [
      { hex: "#FFD23F", name: "Sun" },
      { hex: "#FF8C42", name: "Tangerine" },
      { hex: "#FFE9CC", name: "Vanilla" }
    ]
  }
};

export async function onRequest(context) {
  const { request, env } = context;

  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // 1) 텍스트 결과(JSON) 만들기: 너 기존 로직을 여기 넣어
  const guide = await buildGuide(body, env);

  return json(guide);
}

/**
 * ✅ 너 기존 "텍스트 결과 생성" 로직을 여기 넣어.
 * 반드시 아래 키들은 유지해줘(프론트 renderVipResult가 기대함):
 * imageUrl, targetName, moodLabel, orderText, wrapGuide, flowerMix, palettes, messages, priceInfo, meaning
 */
async function buildGuide(body, env) {
  const relation = String(body.relation || "상대").trim();
  const occasion = String(body.occasion || "선물").trim();
  const rawStyle = String(body.style || "세련된").trim();
  const paletteKey = String(body.palette || "").trim();
  const rawPhotoHabit = String(body.photoHabit || "사진을 자주 남김").trim();
  const rawCautions = Array.isArray(body.cautions) ? body.cautions : [];

  const styleLabelMap = {
    cute: "귀여움",
    chic: "세련/우아",
    romantic: "러블리",
    minimal: "미니멀",
    soft_feminine: "청순",
    chic_elegant: "세련/우아",
    trendy: "트렌디/힙"
  };
  const photoHabitLabelMap = {
    sns_often: "SNS 자주",
    sns_sometimes: "가끔 업로드",
    private_photo: "찍고 보관",
    no_photo: "사진 관심 없음"
  };
  const cautionLabelMap = {
    scent_light: "향은 약한 쪽이 좋아요",
    allergy_sensitive: "알레르기/민감(꽃가루/향 최소)",
    no_rose: "장미는 다른 꽃이면 더 좋아요",
    clean_over_flashy: "화려함보단 깔끔한 게 좋아요",
    none: "없음"
  };

  const style = styleLabelMap[rawStyle] || rawStyle || "세련된";
  const photoHabit = photoHabitLabelMap[rawPhotoHabit] || rawPhotoHabit || "사진을 자주 남김";
  const cautions = rawCautions
    .map(v => cautionLabelMap[v] || String(v))
    .filter(v => v && v !== "없음" && v !== "none");

  const paletteMeta = paletteMap[paletteKey] || {
    label: "내추럴",
    colors: [
      { hex: "#EDE7DF", name: "Oat" },
      { hex: "#D2C4B2", name: "Sand" },
      { hex: "#A9B8A0", name: "Moss" }
    ]
  };

  const orderText = [
    `${relation}에게 ${occasion} 선물이에요.`,
    `${style} 무드로 부탁드리고 ${paletteMeta.label} 톤 중심으로 부탁드려요.`,
    `사진은 ${photoHabit} 편이라 디테일이 잘 보이게 정리해주세요.`,
    cautions.length ? `주의사항: ${cautions.join(", ")}` : "주의사항: 너무 화려하지 않게, 과하지 않게.",
    "포인트 꽃 1~2개로 고급스럽게 잡아주세요."
  ].join("\n");

  const response = {
    __build: "TEST-IMAGE-CHECK-1",
    imageUrl: "https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=900&q=80",
    targetName: relation,
    moodLabel: paletteMeta.label,
    orderText,
    wrapGuide: "무광 크라프트지 + 얇은 리본, 포장 과하지 않게.",
    flowerMix: "메인: 라넌큘러스\n서브: 스프레이 장미\n필러: 유칼립투스",
    palettes: paletteMeta.colors,
    messages: [
      `${relation}에게 잘 어울릴 것 같아 준비했어.`,
      `오늘 하루가 ${relation}에게 특별했으면 좋겠어.`,
      `${occasion} 정말 축하해!`,
      "너만 생각나서 골랐어.",
      "꽃처럼 예쁜 하루 보내."
    ],
    priceInfo: "M 사이즈 기준 약 5만~8만 원",
    meaning: "다정함과 설렘의 무드"
  };

  // ✅ 이미지 생성(실패해도 텍스트 결과는 반환)
  try {
    const prompt = makeBouquetPrompt({
      moodLabel: response.moodLabel,
      wrapGuide: response.wrapGuide,
      flowerMix: response.flowerMix,
      palettes: response.palettes
    });

    const b64 = await generateBouquetImageB64({
      apiKey: env.OPENAI_API_KEY,
      prompt
    });

    response.imageUrl = `data:image/webp;base64,${b64}`;
    console.log("[usage] image_generated", { model: "gpt-image-1", size: "1024x1024" });
  } catch (e) {
    console.error("[getFlowerGuide] image generation failed:", e?.message || e);
  }

  return response;
}

/** 텍스트 결과를 기반으로 "제품컷 스타일 꽃다발 이미지" 프롬프트 생성 */
function makeBouquetPrompt({ moodLabel, wrapGuide, flowerMix, palettes }) {
  const paletteHint = (palettes || [])
    .slice(0, 3)
    .map(p => `${p.name}(${p.hex})`)
    .join(", ");

  return [
    "Realistic florist bouquet product photo, centered.",
    "Clean white background, soft natural shadow, studio lighting.",
    "No text, no watermark, no people, no hands.",
    `Color tone: ${moodLabel}.`,
    `Flower mix: ${String(flowerMix).replace(/\n/g, ", ")}.`,
    `Wrapping: ${wrapGuide}.`,
    paletteHint ? `Palette hints: ${paletteHint}.` : "",
    "Bouquet occupies about 60% of the frame height, straight-on camera."
  ].filter(Boolean).join(" ");
}

/** OpenAI Images API 호출 → base64(webp) 반환 */
async function generateBouquetImageB64({ apiKey, prompt }) {
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      output_format: "webp",
      output_compression: 80,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI image API error ${res.status}: ${t}`);
  }

  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("No b64_json returned");
  return b64;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // 같은 도메인에서만 쓰면 CORS 불필요.
      // 외부에서 호출할 계획이면 아래 주석 해제:
      // "access-control-allow-origin": "*",
    },
  });
}
