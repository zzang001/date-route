const DateRouteAPI = (() => {
  const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
  const TIME_SLOT_LABEL = { day: '낮 (점심~오후)', evening: '저녁 (저녁~밤)', allday: '하루 종일' };
  const TRANSPORT_LABEL = { walk: '도보', transit: '대중교통', car: '자차' };

  function buildPrompt(selections, indexedData) {
    const { region, themes, filters } = selections;
    const { city, district } = region;
    const { timeSlot, transport } = filters;
    const placeCount = timeSlot === 'allday' ? '5~7개' : '3~4개';
    const hasRealData = !!indexedData;
    const systemPrompt = hasRealData
      ? `당신은 대한민국 데이트 코스 전문 큐레이터입니다.\n아래에 카카오맵에서 실시간으로 검색된 장소 목록이 제공됩니다. 각 장소에는 고유한 ref 코드(R1, C2, A3 등)가 부여되어 있습니다.\n장소를 선택할 때는 반드시 해당 ref 코드만 사용하세요. 이름이나 주소는 직접 작성하지 마세요.\n목록에 없는 장소는 절대 추천하지 마세요.\n반드시 순수 JSON만 응답하세요. 마크다운 코드블록 없이 JSON만 반환하세요.`
      : `당신은 대한민국 데이트 코스 전문 큐레이터입니다.\n최근 1년 이내에 인스타그램, 네이버 블로그, 카카오맵 리뷰에서 실제로 화제가 된 장소만 추천하세요.\n반드시 실제 방문 가능한 특정 가게·식당·카페·명소의 정확한 상호명을 제시하세요.\n반드시 순수 JSON만 응답하세요. 마크다운 코드블록 없이 JSON만 반환하세요.`;
    const refSchema = hasRealData
      ? `{"ref":"ref코드(예:R1)","order":순서,"one_liner":"한줄소개","reason":"추천이유","operating_hours":"영업시간","estimated_cost_per_person":비용,"congestion_tip":"혼잡도팁","duration_minutes":체류분,"is_limited_period":false,"limited_until":null}`
      : `{"order":순서,"name":"장소명","category":"restaurant|cafe|attraction|event","one_liner":"한줄소개","reason":"추천이유","address":"주소","operating_hours":"영업시간","estimated_cost_per_person":비용,"congestion_tip":"혼잡도팁","duration_minutes":체류분,"is_limited_period":false,"limited_until":null}`;
    const userPrompt = `다음 조건에 맞는 데이트 코스를 ${placeCount} 구성해주세요.\n\n조건:\n- 지역: ${city} ${district}\n- 테마: ${themes.join(', ')}\n- 시간대: ${TIME_SLOT_LABEL[timeSlot]||timeSlot}\n- 이동수단: ${TRANSPORT_LABEL[transport]||transport}\n\n${hasRealData?`${indexedData.text}\n\n위 목록에서 ref 코드로 선택하여 코스를 구성해주세요. places 배열의 각 항목에 "ref" 필드로 코드를 입력하세요.`:''}\n\n아래 JSON 스키마를 정확히 따라 응답해주세요:\n{"course":{"title":"코스제목","summary":"한줄소개","total_duration_minutes":총분,"total_budget_per_person":총비용,"places":[${refSchema}],"transit_tips":[{"from_order":1,"to_order":2,"duration_minutes":분,"method":"이동방법"}]}}`;
    return { systemPrompt, userPrompt };
  }

  function enrichPlaces(course, refMap) {
    const nameMap = {};
    Object.values(refMap).forEach((real) => { nameMap[real.name] = real; });
    course.places = course.places.map((place) => {
      let real = refMap[place.ref] || null;
      if (!real && place.name) real = nameMap[place.name] || null;
      if (!real) return null;
      return { order: place.order, name: real.name, category: real.category, address: real.address, x: real.x, y: real.y, one_liner: place.one_liner, reason: place.reason, operating_hours: place.operating_hours, estimated_cost_per_person: place.estimated_cost_per_person, congestion_tip: place.congestion_tip, duration_minutes: place.duration_minutes, is_limited_period: place.is_limited_period, limited_until: place.limited_until };
    }).filter(Boolean);
    return course;
  }

  function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function callGroqOnce(model, systemPrompt, userPrompt, signal) {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DateRouteConfig.GROQ_API_KEY}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], response_format: { type: 'json_object' }, temperature: 0.7 }),
      signal,
    });
    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      const errType = (response.status === 429 || response.status === 503) ? 'RATE_LIMIT' : 'API_ERROR';
      throw { type: errType, status: response.status, body: errBody };
    }
    const json = await response.json();
    const content = json?.choices?.[0]?.message?.content;
    if (!content) throw { type: 'API_ERROR', body: 'empty content' };
    return { content, model };
  }

  async function callGroq(model, systemPrompt, userPrompt, timeoutMs) {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      try {
        const result = await callGroqOnce(model, systemPrompt, userPrompt, controller.signal);
        clearTimeout(timerId);
        return result;
      } catch (firstErr) {
        if (!(firstErr.type === 'RATE_LIMIT' || firstErr.status === 503)) throw firstErr;
        await delay(4000);
        const result = await callGroqOnce(model, systemPrompt, userPrompt, controller.signal);
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

  function parseContent(content) {
    try { const p = JSON.parse(content); return (p && p.course) ? p : null; } catch (_) { return null; }
  }

  async function recommend(selections) {
    const startTime = Date.now();
    let indexedData = null;
    try {
      const realPlaces = await window.KakaoLocal.getPlacesForArea(selections.region.district);
      if (realPlaces) indexedData = window.KakaoLocal.buildIndexedData(realPlaces);
    } catch (_) {}
    const { systemPrompt, userPrompt } = buildPrompt(selections, indexedData);
    try {
      const result = await callGroq(DateRouteConfig.PRIMARY_MODEL, systemPrompt, userPrompt, DateRouteConfig.PRIMARY_TIMEOUT_MS);
      const parsed = parseContent(result.content);
      if (parsed) {
        if (indexedData) enrichPlaces(parsed.course, indexedData.refMap);
        if (!(indexedData && parsed.course.places.length < 2)) {
          return { success: true, data: parsed, error: null, model_used: result.model, used_real_data: !!indexedData, latency_ms: Date.now() - startTime };
        }
      }
    } catch (primaryErr) {
      if (primaryErr.type === 'API_ERROR') return { success: false, data: null, error: { code: 'API_ERROR', message: '서비스에 일시적인 문제가 발생했습니다.' }, model_used: DateRouteConfig.PRIMARY_MODEL, latency_ms: Date.now() - startTime };
    }
    const remainingMs = DateRouteConfig.TOTAL_TIMEOUT_MS - (Date.now() - startTime);
    if (remainingMs <= 0) return { success: false, data: null, error: { code: 'TIMEOUT', message: 'AI 응답 시간이 초과되었습니다. 다시 시도해주세요.' }, model_used: DateRouteConfig.FALLBACK_MODEL, latency_ms: Date.now() - startTime };
    try {
      const fallback = await callGroq(DateRouteConfig.FALLBACK_MODEL, systemPrompt, userPrompt, remainingMs);
      const parsed = parseContent(fallback.content);
      if (parsed) {
        if (indexedData) enrichPlaces(parsed.course, indexedData.refMap);
        if (indexedData && parsed.course.places.length < 2) return { success: false, data: null, error: { code: 'PARSE_ERROR', message: '카카오맵 장소 데이터를 기반으로 코스를 구성하지 못했습니다. 다시 시도해주세요.' }, model_used: fallback.model, latency_ms: Date.now() - startTime };
        return { success: true, data: parsed, error: null, model_used: fallback.model, used_real_data: !!indexedData, latency_ms: Date.now() - startTime };
      }
      return { success: false, data: null, error: { code: 'PARSE_ERROR', message: 'AI 응답을 처리하지 못했습니다. 다시 시도해주세요.' }, model_used: fallback.model, latency_ms: Date.now() - startTime };
    } catch (fallbackErr) {
      const code = fallbackErr.type === 'TIMEOUT' ? 'TIMEOUT' : fallbackErr.type === 'RATE_LIMIT' ? 'RATE_LIMIT' : 'API_ERROR';
      const message = code === 'TIMEOUT' ? 'AI 응답 시간이 초과되었습니다.' : code === 'RATE_LIMIT' ? 'AI 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.' : '서비스에 일시적인 문제가 발생했습니다.';
      return { success: false, data: null, error: { code, message }, model_used: DateRouteConfig.FALLBACK_MODEL, latency_ms: Date.now() - startTime };
    }
  }

  return { recommend };
})();

window.DateRouteAPI = DateRouteAPI;
