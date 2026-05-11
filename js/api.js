const DateRouteAPI = (() => {
  const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

  function buildPrompt(selections, indexedData) {
    const { region, themes } = selections;
    const { city, district } = region;
    const placeCount = '3~4개';
    const hasRealData = !!indexedData;

    const systemPrompt = hasRealData
      ? `당신은 대한민국 데이트 코스 전문 큐레이터입니다.
아래에 카카오맵에서 실시간으로 검색된 장소 목록이 제공됩니다. 각 장소에는 고유한 ref 코드(R1, C2, A3 등)가 부여되어 있습니다.
장소를 선택할 때는 반드시 해당 ref 코드만 사용하세요. 이름이나 주소는 직접 작성하지 마세요.
목록에 없는 장소는 절대 추천하지 마세요.
반드시 순수 JSON만 응답하세요. 마크다운 코드블록 없이 JSON만 반환하세요.`
      : `당신은 대한민국 데이트 코스 전문 큐레이터입니다.
최근 1년 이내에 인스타그램, 네이버 블로그, 카카오맵 리뷰에서 실제로 화제가 된 장소만 추천하세요.
반드시 실제 방문 가능한 특정 가게·식당·카페·명소의 정확한 상호명을 제시하세요.
'○○거리', '○○로', '○○골목' 같은 지역·거리 이름은 절대 장소로 제시하지 마세요.
이미 폐업했거나 트렌드가 지난 장소는 반드시 제외하세요.
반드시 순수 JSON만 응답하세요. 마크다운 코드블록 없이 JSON만 반환하세요.`;

    const refSchema = hasRealData ? `
      {
        "ref": "목록의 ref 코드 (string, 예: R1, C2, A3)",
        "order": 방문 순서(number, 1부터 시작),
        "one_liner": "장소 한줄 소개 (string)",
        "reason": "이 장소를 추천하는 이유 (string)",
        "operating_hours": "영업 시간 (string, 예: 11:00-22:00)",
        "estimated_cost_per_person": 1인 예상 비용(원, number),
        "congestion_tip": "혼잡도 및 방문 팁 (string)",
        "duration_minutes": 체류 예상 시간(분, number),
        "is_limited_period": 한정 기간 운영 여부(boolean),
        "limited_until": "한정 종료일 (string, YYYY-MM-DD) 또는 null"
      }` : `
      {
        "order": 방문 순서(number, 1부터 시작),
        "name": "장소명 (string)",
        "category": "restaurant | cafe | attraction | event",
        "one_liner": "장소 한줄 소개 (string)",
        "reason": "이 장소를 추천하는 이유 (string)",
        "address": "도로명 주소 (string)",
        "operating_hours": "영업 시간 (string)",
        "estimated_cost_per_person": 1인 예상 비용(원, number),
        "congestion_tip": "혼잡도 및 방문 팁 (string)",
        "duration_minutes": 체류 예상 시간(분, number),
        "is_limited_period": 한정 기간 운영 여부(boolean),
        "limited_until": "한정 종료일 (string, YYYY-MM-DD) 또는 null"
      }`;

    const userPrompt = `다음 조건에 맞는 데이트 코스를 ${placeCount} 구성해주세요.

조건:
- 지역: ${city} ${district}
- 테마: ${themes.join(', ')}
- 이동수단: 도보 및 대중교통

${hasRealData ? `${indexedData.text}

위 목록에서 조건에 가장 잘 맞는 장소를 ref 코드로 선택하여 최적의 데이트 코스를 구성해주세요.
places 배열의 각 항목에 "ref" 필드로 해당 장소의 코드를 입력하세요.` : ''}

아래 JSON 스키마를 정확히 따라 응답해주세요. 설명 없이 JSON만 반환하세요:

{
  "course": {
    "title": "코스 제목 (string)",
    "summary": "코스 한줄 소개 (string)",
    "total_duration_minutes": 총 소요시간(분, number),
    "total_budget_per_person": 1인 총 예상 비용(원, number),
    "places": [${refSchema}
    ],
    "transit_tips": [
      {
        "from_order": 출발 장소 순서(number),
        "to_order": 도착 장소 순서(number),
        "duration_minutes": 이동 소요시간(분, number),
        "method": "이동 방법 설명 (string)"
      }
    ]
  }
}`;

    return { systemPrompt, userPrompt };
  }

  // ─────────────────────────────────────────
  // ref 코드 → 실제 카카오 데이터로 치환
  // ─────────────────────────────────────────
  function enrichPlaces(course, refMap) {
    const nameMap = {};
    Object.values(refMap).forEach((real) => {
      nameMap[real.name] = real;
    });

    course.places = course.places
      .map((place) => {
        let real = refMap[place.ref] || null;
        if (!real && place.name) real = nameMap[place.name] || null;
        if (!real) return null;

        return {
          order:                     place.order,
          name:                      real.name,
          category:                  real.category,
          address:                   real.address,
          x:                         real.x,
          y:                         real.y,
          one_liner:                 place.one_liner,
          reason:                    place.reason,
          operating_hours:           place.operating_hours,
          estimated_cost_per_person: place.estimated_cost_per_person,
          congestion_tip:            place.congestion_tip,
          duration_minutes:          place.duration_minutes,
          is_limited_period:         place.is_limited_period,
          limited_until:             place.limited_until,
        };
      })
      .filter(Boolean);

    return course;
  }

  // ─────────────────────────────────────────
  // Gemini API 호출 (429 시 1회 재시도)
  // ─────────────────────────────────────────
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function callGeminiOnce(model, systemPrompt, userPrompt, signal) {
    const body = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    };

    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DateRouteConfig.GROQ_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      console.error('[Gemini error]', response.status, errBody);
      const errType = (response.status === 429 || response.status === 503) ? 'RATE_LIMIT' : 'API_ERROR';
      throw { type: errType, status: response.status, body: errBody };
    }

    const json = await response.json();
    const content = json?.choices?.[0]?.message?.content;
    if (!content) throw { type: 'API_ERROR', body: 'empty content' };
    return { content, model };
  }

  async function callGemini(model, systemPrompt, userPrompt, timeoutMs) {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      try {
        const result = await callGeminiOnce(model, systemPrompt, userPrompt, controller.signal);
        clearTimeout(timerId);
        return result;
      } catch (firstErr) {
        const retryable = firstErr.type === 'RATE_LIMIT' || firstErr.status === 503;
        if (!retryable) throw firstErr;
        // 429/503 → 4초 대기 후 1회 재시도
        await delay(4000);
        const result = await callGeminiOnce(model, systemPrompt, userPrompt, controller.signal);
        clearTimeout(timerId);
        return result;
      }
    } catch (err) {
      clearTimeout(timerId);
      if (err.name === 'AbortError') throw { type: 'TIMEOUT' };
      if (err.type) throw err;
      throw { type: 'API_ERROR', cause: err };
    }
  }

  // ─────────────────────────────────────────
  // JSON 파싱 및 검증
  // ─────────────────────────────────────────
  function parseContent(content) {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && parsed.course) return parsed;
      return null;
    } catch (_) {
      return null;
    }
  }

  // ─────────────────────────────────────────
  // 핵심 메서드: recommend
  // ─────────────────────────────────────────
  async function recommend(selections) {
    const startTime = Date.now();

    // Step 1: 카카오 SDK → 실제 장소 목록
    let indexedData = null;
    try {
      const realPlaces = await window.KakaoLocal.getPlacesForArea(selections.region.district);
      if (realPlaces) indexedData = window.KakaoLocal.buildIndexedData(realPlaces);
    } catch (_) {
      indexedData = null;
    }

    // Step 2: 프롬프트 생성
    const { systemPrompt, userPrompt } = buildPrompt(selections, indexedData);

    // Step 3: Primary 모델 호출
    try {
      const result = await callGemini(
        DateRouteConfig.PRIMARY_MODEL,
        systemPrompt,
        userPrompt,
        DateRouteConfig.PRIMARY_TIMEOUT_MS,
      );
      const parsed = parseContent(result.content);
      if (parsed) {
        if (indexedData) enrichPlaces(parsed.course, indexedData.refMap);
        if (indexedData && parsed.course.places.length < 2) {
          // ref를 무시한 경우 → Fallback으로 재시도
        } else {
          return {
            success: true,
            data: parsed,
            error: null,
            model_used: result.model,
            used_real_data: !!indexedData,
            latency_ms: Date.now() - startTime,
          };
        }
      }
    } catch (primaryErr) {
      if (primaryErr.type === 'API_ERROR') {
        return {
          success: false, data: null,
          error: { code: 'API_ERROR', message: '서비스에 일시적인 문제가 발생했습니다.' },
          model_used: DateRouteConfig.PRIMARY_MODEL,
          latency_ms: Date.now() - startTime,
        };
      }
      // TIMEOUT or RATE_LIMIT → Fallback
    }

    // Step 4: Fallback 모델 호출
    const remainingMs = DateRouteConfig.TOTAL_TIMEOUT_MS - (Date.now() - startTime);
    if (remainingMs <= 0) {
      return {
        success: false, data: null,
        error: { code: 'TIMEOUT', message: 'AI 응답 시간이 초과되었습니다. 다시 시도해주세요.' },
        model_used: DateRouteConfig.FALLBACK_MODEL,
        latency_ms: Date.now() - startTime,
      };
    }

    try {
      const fallback = await callGemini(
        DateRouteConfig.FALLBACK_MODEL,
        systemPrompt,
        userPrompt,
        remainingMs,
      );
      const parsed = parseContent(fallback.content);
      if (parsed) {
        if (indexedData) enrichPlaces(parsed.course, indexedData.refMap);
        if (indexedData && parsed.course.places.length < 2) {
          return {
            success: false, data: null,
            error: { code: 'PARSE_ERROR', message: '카카오맵 장소 데이터를 기반으로 코스를 구성하지 못했습니다. 다시 시도해주세요.' },
            model_used: fallback.model,
            latency_ms: Date.now() - startTime,
          };
        }
        return {
          success: true,
          data: parsed,
          error: null,
          model_used: fallback.model,
          used_real_data: !!indexedData,
          latency_ms: Date.now() - startTime,
        };
      }
      return {
        success: false, data: null,
        error: { code: 'PARSE_ERROR', message: 'AI 응답을 처리하지 못했습니다. 다시 시도해주세요.' },
        model_used: fallback.model,
        latency_ms: Date.now() - startTime,
      };
    } catch (fallbackErr) {
      let code, message;
      if (fallbackErr.type === 'TIMEOUT') {
        code = 'TIMEOUT';
        message = 'AI 응답 시간이 초과되었습니다. 다시 시도해주세요.';
      } else if (fallbackErr.type === 'RATE_LIMIT') {
        code = 'RATE_LIMIT';
        message = 'AI 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요. (Gemini 무료 플랜 분당 15회 한도)';
      } else {
        code = 'API_ERROR';
        message = '서비스에 일시적인 문제가 발생했습니다.';
      }
      return {
        success: false, data: null,
        error: { code, message },
        model_used: DateRouteConfig.FALLBACK_MODEL,
        latency_ms: Date.now() - startTime,
      };
    }
  }

  return { recommend };
})();

window.DateRouteAPI = DateRouteAPI;
