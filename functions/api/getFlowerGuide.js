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

function withCors(headers) {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  return headers;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export async function onRequest(context) {
  const { request } = context;
  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers: withCors(new Headers()) });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: withCors(new Headers({ "Content-Type": "application/json" }))
    });
  }

  const body = await request.json().catch(() => ({}));
  const relation = String(body.relation || "상대").trim();
  const occasion = String(body.occasion || "선물").trim();
  const style = String(body.style || "세련된").trim();
  const paletteKey = String(body.palette || "").trim();
  const photoHabit = String(body.photoHabit || "사진을 자주 남김").trim();
  const cautions = safeArray(body.cautions);

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

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: withCors(new Headers({ "Content-Type": "application/json" }))
  });
}
