export async function onRequestPost({ request, env }) {
  if (!env || !env.OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: 'missing_api_key' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const systemPrompt = [
    '너는 한국어로 꽃집 주문서를 만드는 플로리스트 어시스턴트야.',
    '요청된 스키마에 맞춰 JSON만 출력해.',
    '멘트 5개는 상황별로 다르게 써.',
    '주문서 3종은 짧게/디테일/당일픽업으로 구성해.'
  ].join(' ');

  const userPrompt = [
    '아래 입력을 참고해서 PRO 결과를 만들어줘.',
    '입력:',
    JSON.stringify(payload, null, 2)
  ].join('\n');

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['reference_image_prompt', 'orders', 'messages'],
    properties: {
      reference_image_prompt: { type: 'string' },
      orders: {
        type: 'object',
        additionalProperties: false,
        required: ['short', 'detailed', 'pickup'],
        properties: {
          short: { type: 'string' },
          detailed: { type: 'string' },
          pickup: { type: 'string' }
        }
      },
      messages: {
        type: 'array',
        minItems: 5,
        maxItems: 5,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['situation', 'text'],
          properties: {
            situation: { type: 'string' },
            text: { type: 'string' }
          }
        }
      }
    }
  };

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      input: [
        { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
        { role: 'user', content: [{ type: 'text', text: userPrompt }] }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'pro_output',
          strict: true,
          schema
        }
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    return new Response(JSON.stringify({ error: 'openai_error', detail: errText }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const data = await res.json();
  let outputText = '';

  if (typeof data.output_text === 'string') {
    outputText = data.output_text;
  } else if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item && item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c && c.type === 'output_text' && typeof c.text === 'string') {
            outputText += c.text;
          }
        }
      }
    }
  }

  try {
    const parsed = JSON.parse(outputText);
    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid_model_json', raw: outputText }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
