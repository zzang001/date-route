(() => {
  'use strict';
  const CATEGORY_ICONS = { restaurant: '🍽️', cafe: '☕', attraction: '🎯', event: '🎪' };
  const STORAGE_KEY = 'dateroute_saved_courses';
  const MAX_SAVED = 5;
  const state = { currentStep: 1, selections: { region: { city: '서울', district: null }, themes: [], filters: { timeSlot: 'evening', transport: 'transit' } }, courseResult: null, savedCourses: [], mapInitialized: false };

  function $(id) { return document.getElementById(id); }
  function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }
  function show(el) { if (typeof el === 'string') el = $(el); if (el) el.classList.remove('hidden'); }
  function hide(el) { if (typeof el === 'string') el = $(el); if (el) el.classList.add('hidden'); }

  function showToast(message, type) {
    type = type || 'success';
    const container = $('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toast.setAttribute('role', 'status');
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('out'); setTimeout(() => toast.remove(), 300); }, 2000);
  }

  function updateStepIndicator(step) {
    const dots = $$('.step-dot', $('header'));
    dots.forEach((dot, idx) => { const s = idx + 1; dot.classList.toggle('active', s === step); dot.classList.toggle('done', s < step); });
    const indicator = $('header-step-indicator');
    (step === 'loading' || step === 'result') ? hide(indicator) : show(indicator);
  }

  function showStep(step) {
    ['step-1','step-2','step-3','loading','result'].forEach(hide);
    const errorEl = $('error-screen'); if (errorEl) errorEl.remove();
    if (step === 'loading') show('loading');
    else if (step === 'result') show('result');
    else show(`step-${step}`);
    state.currentStep = step;
    updateStepIndicator(step);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function initStep1() {
    const chips = $$('.region-chip', $('district-chips')), nextBtn = $('step1-next');
    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        chips.forEach((c) => { c.classList.remove('active'); c.setAttribute('aria-pressed', 'false'); });
        chip.classList.add('active'); chip.setAttribute('aria-pressed', 'true');
        state.selections.region.district = chip.dataset.value; nextBtn.disabled = false;
      });
    });
    nextBtn.addEventListener('click', () => { if (state.selections.region.district) showStep(2); });
  }

  function initStep2() {
    const cards = $$('.theme-card', $('theme-cards')), nextBtn = $('step2-next'), backBtn = $('step2-back');
    cards.forEach((card) => {
      card.addEventListener('click', () => {
        const value = card.dataset.value, isActive = card.classList.contains('active');
        if (isActive) { card.classList.remove('active'); card.setAttribute('aria-pressed', 'false'); state.selections.themes = state.selections.themes.filter((t) => t !== value); }
        else {
          if (state.selections.themes.length >= 2) { showToast('최대 2개까지 선택할 수 있어요', 'warning'); return; }
          card.classList.add('active'); card.setAttribute('aria-pressed', 'true'); state.selections.themes.push(value);
        }
        nextBtn.disabled = state.selections.themes.length === 0;
      });
    });
    nextBtn.addEventListener('click', () => { if (state.selections.themes.length > 0) showStep(3); });
    backBtn.addEventListener('click', () => showStep(1));
  }

  function initStep3() {
    const filterChips = $$('.filter-chip'), submitBtn = $('step3-submit'), backBtn = $('step3-back');
    filterChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        const group = chip.dataset.group, value = chip.dataset.value;
        $$(`[data-group="${group}"]`).forEach((s) => { s.classList.remove('active'); s.setAttribute('aria-pressed', 'false'); });
        chip.classList.add('active'); chip.setAttribute('aria-pressed', 'true');
        state.selections.filters[group] = value;
      });
    });
    submitBtn.addEventListener('click', () => submitRequest());
    backBtn.addEventListener('click', () => showStep(2));
  }

  let loadingTimers = [];
  function startLoadingSequence(district) {
    loadingTimers.forEach(clearTimeout); loadingTimers = [];
    const steps = [$('loading-step-1'), $('loading-step-2'), $('loading-step-3')];
    steps.forEach((el) => { if (el) el.classList.remove('visible'); });
    if (steps[0]) steps[0].textContent = `📍 카카오맵에서 ${district} 장소 검색 중...`;
    steps.forEach((el, idx) => { const t = setTimeout(() => { if (el) { el.classList.add('visible'); el.setAttribute('aria-hidden', 'false'); } }, (idx + 1) * 1500); loadingTimers.push(t); });
  }

  async function submitRequest() {
    const district = state.selections.region.district;
    showStep('loading'); startLoadingSequence(district);
    try {
      const response = await window.DateRouteAPI.recommend(state.selections);
      loadingTimers.forEach(clearTimeout);
      if (!response.success) { showError(response.error); return; }
      state.courseResult = response.data.course;
      state.usedRealData = !!response.used_real_data;
      renderResult(state.courseResult, state.usedRealData);
      showStep('result');
      if (window.innerWidth >= 768) {
        state.mapInitialized = true;
        setTimeout(() => { DateRouteMap.init('kakao-map').then(() => { if (state.courseResult) DateRouteMap.renderCourse(state.courseResult.places); }); }, 300);
      }
    } catch (err) {
      loadingTimers.forEach(clearTimeout);
      showError({ code: 'UNKNOWN', message: '예기치 못한 오류가 발생했습니다. 다시 시도해주세요.' });
    }
  }

  function showError(error) {
    hide('loading');
    let errorEl = $('error-screen');
    if (!errorEl) { errorEl = document.createElement('section'); errorEl.id = 'error-screen'; errorEl.setAttribute('role', 'alert'); $('app').appendChild(errorEl); }
    errorEl.innerHTML = `<div class="error-icon">😢</div><h2 class="error-title">코스 생성에 실패했어요</h2><p class="error-message">${escapeHtml(error.message||'알 수 없는 오류가 발생했습니다.')}</p><button class="btn-primary" id="error-retry" type="button" style="max-width:240px;margin-top:8px">다시 시도하기</button>`;
    show(errorEl); state.currentStep = 'error'; updateStepIndicator('result');
    $('error-retry').addEventListener('click', () => { errorEl.remove(); showStep(3); });
  }

  function formatMinutes(mins) { const h = Math.floor(mins/60), m = mins%60; if (h>0&&m>0) return `${h}시간 ${m}분`; if (h>0) return `${h}시간`; return `${m}분`; }
  function formatBudget(won) { if (won>=10000) { const man=Math.floor(won/10000),rem=won%10000; return rem>0?`${man}만 ${rem.toLocaleString()}원`:`${man}만원`; } return `${won.toLocaleString()}원`; }

  function renderResult(course, usedRealData) {
    $('result-title').textContent = course.title;
    $('result-summary-text').textContent = course.summary;
    const dsEl = $('result-data-source');
    if (dsEl) { dsEl.textContent = usedRealData ? '📍 카카오 실시간 검색 기반' : '🤖 AI 추천 (실시간 검색 미적용)'; dsEl.className = 'result-data-source ' + (usedRealData ? 'real' : 'ai'); }
    $('summary-duration').textContent = formatMinutes(course.total_duration_minutes);
    $('summary-budget').textContent = formatBudget(course.total_budget_per_person);
    $('summary-places').textContent = `${course.places.length}곳`;
    renderTimeline(course.places, course.transit_tips);
    state.mapInitialized = false;
  }

  function renderTimeline(places, transitTips) {
    const container = $('timeline-view'); container.innerHTML = '';
    const tipMap = {}; if (transitTips) transitTips.forEach((t) => { tipMap[t.from_order] = t; });
    places.forEach((place, idx) => {
      container.appendChild(buildPlaceCard(place));
      const next = places[idx+1]; if (next) container.appendChild(buildTransitRow(tipMap[place.order], place.order, next.order));
    });
  }

  function buildPlaceCard(place) {
    const card = document.createElement('article');
    card.className = 'place-card'; card.setAttribute('tabindex', '0'); card.setAttribute('role', 'button'); card.setAttribute('aria-label', `${place.name} 상세 정보 보기`);
    const icon = CATEGORY_ICONS[place.category] || '📍';
    card.innerHTML = `<div class="place-order-badge" aria-hidden="true">${place.order}</div><div class="place-content"><div class="place-top-row"><span class="place-category-icon" aria-hidden="true">${icon}</span><span class="place-name">${escapeHtml(place.name)}</span>${place.is_limited_period?'<span class="badge-limited">기간 한정</span>':''}</div><p class="place-one-liner">${escapeHtml(place.one_liner)}</p><p class="place-reason">${escapeHtml(place.reason)}</p><div class="place-meta"><span class="place-meta-item"><span class="meta-icon" aria-hidden="true">💰</span><span>${formatBudget(place.estimated_cost_per_person)}</span></span><span class="place-meta-item"><span class="meta-icon" aria-hidden="true">⏱</span><span>${formatMinutes(place.duration_minutes)}</span></span></div></div>`;
    card.addEventListener('click', () => showPlaceModal(place));
    card.addEventListener('keydown', (e) => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); showPlaceModal(place); } });
    return card;
  }

  function buildTransitRow(tip, fromOrder, toOrder) {
    const row = document.createElement('div'); row.className = 'transit-row'; row.setAttribute('aria-label', `${fromOrder}번에서 ${toOrder}번 이동`);
    row.innerHTML = `<div class="transit-dot" aria-hidden="true"></div><div class="transit-info"><span class="transit-method">${tip?escapeHtml(tip.method):'이동'}</span>${tip?`<span class="transit-duration">${tip.duration_minutes}분</span>`:''}</div>`;
    return row;
  }

  function showPlaceModal(place) {
    const icon = CATEGORY_ICONS[place.category] || '📍';
    const mapUrl = `https://map.kakao.com/link/search/${encodeURIComponent(place.address)}`;
    $('modal-content').innerHTML = `<div class="modal-place-header"><div class="modal-order-badge" aria-hidden="true">${place.order}</div><div class="modal-title-group"><h2 class="modal-place-name" id="modal-title"><span aria-hidden="true">${icon}</span> ${escapeHtml(place.name)}</h2><p class="modal-one-liner">${escapeHtml(place.one_liner)}</p></div></div><div class="modal-detail-row"><div class="modal-detail-icon">🕐</div><div class="modal-detail-body"><div class="modal-detail-label">영업시간</div><div class="modal-detail-value">${escapeHtml(place.operating_hours)}</div></div></div><div class="modal-detail-row"><div class="modal-detail-icon">📍</div><div class="modal-detail-body"><div class="modal-detail-label">주소</div><div class="modal-detail-value"><a href="${mapUrl}" target="_blank" rel="noopener noreferrer" class="modal-address-link">${escapeHtml(place.address)}</a></div></div></div><div class="modal-detail-row"><div class="modal-detail-icon">💰</div><div class="modal-detail-body"><div class="modal-detail-label">예상 비용 (1인)</div><div class="modal-detail-value">${formatBudget(place.estimated_cost_per_person)}</div></div></div><div class="modal-detail-row"><div class="modal-detail-icon">⏱</div><div class="modal-detail-body"><div class="modal-detail-label">체류 시간</div><div class="modal-detail-value">${formatMinutes(place.duration_minutes)}</div></div></div><div class="modal-detail-row"><div class="modal-detail-icon">👥</div><div class="modal-detail-body"><div class="modal-detail-label">혼잡도 & 팁</div><div class="modal-detail-value">${escapeHtml(place.congestion_tip)}</div></div></div>${place.is_limited_period?`<div class="modal-detail-row"><div class="modal-detail-icon">📅</div><div class="modal-detail-body"><div class="modal-detail-label">기간 한정</div><div class="modal-detail-value">${place.limited_until?place.limited_until+'까지':'기간 확인 필요'}</div></div></div>`:''}<div class="modal-reason-box">${escapeHtml(place.reason)}</div>`;
    show('modal-overlay'); $('modal-close').focus();
  }

  function closePlaceModal() { hide('modal-overlay'); }

  function initTabs() {
    const tabTL = $('tab-timeline'), tabMap = $('tab-map'), tlView = $('timeline-view'), mapView = $('map-view');
    tabTL.addEventListener('click', () => { tabTL.classList.add('active'); tabTL.setAttribute('aria-selected','true'); tabMap.classList.remove('active'); tabMap.setAttribute('aria-selected','false'); show(tlView); hide(mapView); });
    tabMap.addEventListener('click', () => {
      tabMap.classList.add('active'); tabMap.setAttribute('aria-selected','true'); tabTL.classList.remove('active'); tabTL.setAttribute('aria-selected','false'); hide(tlView); show(mapView);
      if (!state.mapInitialized && state.courseResult) { state.mapInitialized = true; setTimeout(() => { DateRouteMap.init('kakao-map').then(() => { if (state.courseResult) DateRouteMap.renderCourse(state.courseResult.places); }); }, 100); }
    });
  }

  function initResultActions() {
    $('result-back').addEventListener('click', () => { state.courseResult=null; state.mapInitialized=false; DateRouteMap.clear(); showStep(1); resetSelections(); });
    $('action-retry').addEventListener('click', () => { state.mapInitialized=false; DateRouteMap.clear(); submitRequest(); });
    $('action-save').addEventListener('click', handleSave);
    $('action-share').addEventListener('click', handleShare);
    $('action-capture').addEventListener('click', handleCapture);
  }

  function handleSave() {
    if (!state.courseResult) return;
    const saved = loadSavedCourses();
    if (saved.some((e) => e.course.title === state.courseResult.title)) { showToast('이미 저장된 코스예요', 'warning'); return; }
    if (saved.length >= MAX_SAVED) { showToast(`저장 가능한 코스는 최대 ${MAX_SAVED}개입니다`, 'warning'); return; }
    saved.push({ id: Date.now().toString(), savedAt: new Date().toISOString(), course: state.courseResult, selections: JSON.parse(JSON.stringify(state.selections)) });
    saveCourses(saved); showToast('코스가 저장되었어요', 'success');
  }

  async function handleShare() {
    if (!state.courseResult) return;
    try {
      const url = `${location.origin}${location.pathname}?data=${btoa(unescape(encodeURIComponent(JSON.stringify({course:state.courseResult}))))}`;
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); } else { const t=document.createElement('textarea'); t.value=url; t.style.cssText='position:fixed;opacity:0'; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
      showToast('공유 링크가 복사되었어요', 'success');
    } catch (_) { showToast('링크 복사에 실패했어요', 'error'); }
  }

  async function handleCapture() {
    if (!$('timeline-view') || typeof html2canvas === 'undefined') { showToast('이미지 저장을 사용할 수 없어요', 'error'); return; }
    showToast('이미지 저장 중...', 'success');
    try {
      const canvas = await html2canvas($('timeline-view'), { backgroundColor: '#FAFAFA', scale: 2, useCORS: true, allowTaint: false, logging: false });
      const link = document.createElement('a'); link.download = `dateroute-${Date.now()}.png`; link.href = canvas.toDataURL('image/png'); link.click();
      showToast('이미지가 저장되었어요', 'success');
    } catch (_) { showToast('이미지 저장에 실패했어요', 'error'); }
  }

  function tryRestoreFromURL() {
    const encoded = new URLSearchParams(location.search).get('data');
    if (!encoded) return false;
    try {
      const parsed = JSON.parse(decodeURIComponent(escape(atob(encoded))));
      if (!parsed.course || !Array.isArray(parsed.course.places)) return false;
      state.courseResult = parsed.course; renderResult(state.courseResult); showStep('result');
      if (window.innerWidth >= 768) { state.mapInitialized=true; setTimeout(() => { DateRouteMap.init('kakao-map').then(() => { if (state.courseResult) DateRouteMap.renderCourse(state.courseResult.places); }); }, 300); }
      return true;
    } catch (_) { return false; }
  }

  function loadSavedCourses() { try { const r=localStorage.getItem(STORAGE_KEY); return r?JSON.parse(r):[]; } catch(_){return[];} }
  function saveCourses(courses) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(courses)); state.savedCourses=courses; } catch(_){ showToast('저장에 실패했어요. 저장 공간이 부족할 수 있어요.', 'error'); } }

  function resetSelections() {
    state.selections = { region: { city: '서울', district: null }, themes: [], filters: { timeSlot: 'evening', transport: 'transit' } };
    $$('.region-chip').forEach((c) => { c.classList.remove('active'); c.removeAttribute('aria-pressed'); });
    $$('.theme-card').forEach((c) => { c.classList.remove('active'); c.setAttribute('aria-pressed','false'); });
    $('step1-next').disabled = true; $('step2-next').disabled = true;
    $$('.filter-chip').forEach((chip) => { const def={timeSlot:'evening',transport:'transit'}; const is=def[chip.dataset.group]===chip.dataset.value; chip.classList.toggle('active',is); chip.setAttribute('aria-pressed',is?'true':'false'); });
  }

  function escapeHtml(str) { if(typeof str!=='string')return''; return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function boot() {
    state.savedCourses = loadSavedCourses();
    initStep1(); initStep2(); initStep3(); initTabs(); initResultActions();
    $('modal-overlay').addEventListener('click', (e) => { if (e.target===$('modal-overlay')) closePlaceModal(); });
    $('modal-close').addEventListener('click', closePlaceModal);
    document.addEventListener('keydown', (e) => { if (e.key==='Escape') closePlaceModal(); });
    if (!tryRestoreFromURL()) showStep(1);
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
})();
