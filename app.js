'use strict';

const CATEGORIES = ['채소', '과일', '육류', '해산물', '유제품·달걀', '곡류·면', '양념·소스', '가공식품', '기타'];
const STORAGES = ['냉장', '냉동', '실온'];
const STORAGE_ICON = { 냉장: '🧊', 냉동: '❄️', 실온: '🌡️' };
const SOON_DAYS = 3;
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];

const state = { ingredients: [], recipes: [], weekPlan: [] };
let pickOffset = 0;
let editingIngredientId = null;
let editingRecipeId = null;
let viewingRecipeId = null;

const $ = (sel) => document.querySelector(sel);

// ---------- 유틸 ----------
// crypto.randomUUID()는 https나 localhost에서만 있어서, 폰에서 http://192.168.x.x 로
// 접속하면 없다. getRandomValues는 어디서나 되므로 그걸로 UUID를 만든다.
function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// 소비기한 '모름'은 Infinity로 취급: 만료·임박으로 보지 않고 정렬 시 맨 뒤로
function daysLeft(expiryDate) {
  if (!expiryDate) return Infinity;
  return Math.round((parseDate(expiryDate) - parseDate(todayStr())) / 86400000);
}

function ddayLabel(days) {
  if (!Number.isFinite(days)) return '기한 모름';
  if (days < 0) return `만료 D+${-days}`;
  if (days === 0) return 'D-Day';
  return `D-${days}`;
}

function ddayClass(days) {
  if (!Number.isFinite(days)) return 'unknown';
  if (days < 0) return 'expired';
  if (days <= SOON_DAYS) return 'soon';
  return '';
}

function todayDayName() {
  return DAYS[(new Date().getDay() + 6) % 7];
}

// 날짜 문자열 비교. 빈 값('모름')은 방향과 상관없이 항상 맨 뒤
function compareDates(a, b, desc = false) {
  if (!a || !b) return (a ? 0 : 1) - (b ? 0 : 1);
  return desc ? b.localeCompare(a) : a.localeCompare(b);
}

// 입력칸은 YYYY/MM/DD, 저장은 YYYY-MM-DD
function toInputDate(iso) {
  return iso ? iso.replace(/-/g, '/') : '';
}

// '2026/10/09', '2026-10-9', '20261009' 등을 받아 YYYY-MM-DD로. 없는 날짜면 null
function fromInputDate(str) {
  const s = String(str).trim();
  const m = s.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// 숫자만 입력해도 2026/10/09 형태로 슬래시를 넣어준다
function autoSlashDate(input, e) {
  if (!e.inputType || !e.inputType.startsWith('insert')) return;
  if (input.selectionStart !== input.value.length) return;
  const digits = input.value.replace(/\D/g, '').slice(0, 8);
  let out = digits.slice(0, 4);
  if (digits.length > 4) out += '/' + digits.slice(4, 6);
  if (digits.length > 6) out += '/' + digits.slice(6, 8);
  if (/^\d{4}$|^\d{4}\/\d{2}$/.test(out) && digits.length < 8) out += '/';
  input.value = out;
}

function formatDate(str) {
  if (!str) return '모름';
  const d = parseDate(str);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 같은 재료를 가리키는 이름들. 각 줄의 첫 번째 이름으로 통일해서 비교한다.
// 새 동의어가 필요하면 여기에 한 줄 추가하면 된다.
const SYNONYMS = [
  ['달걀', '계란'],
  ['소고기', '쇠고기'],
  ['케첩', '케찹'],
  ['고춧가루', '고추가루'],
  ['후추', '후춧가루'],
  ['마요네즈', '마요네스', '마요'],
  ['대파', '파'],
  ['조미료', '소고기다시다', '쇠고기다시다', '다시다'],
  ['참치', '참치캔'],
];
const SYNONYM_MAP = new Map(SYNONYMS.flatMap(([main, ...others]) => [main, ...others].map((w) => [w, main])));
// 이름 속 일부도 바꾸는 건 2글자 이상만. 1글자('파')는 이름 전체가 같을 때만 바꾼다
// (그래야 '양파', '쪽파'가 '양대파', '쪽대파'가 되지 않는다)
// 긴 단어부터 찾아야 '마요네즈' 안의 '마요'를 따로 바꾸지 않는다
const SYNONYM_RE = new RegExp([...SYNONYM_MAP.keys()].filter((w) => w.length >= 2).sort((x, y) => y.length - x.length).join('|'), 'g');

function compact(name) {
  return String(name).replace(/\s+/g, '').toLowerCase();
}

// 띄어쓰기·대소문자를 무시하고, 동의어는 대표 이름으로 바꾼다 ("유정란 계란" → "유정란달걀")
function normalize(name) {
  const s = compact(name);
  if (SYNONYM_MAP.has(s)) return SYNONYM_MAP.get(s);
  return s.replace(SYNONYM_RE, (w) => SYNONYM_MAP.get(w));
}

// "돼지고기 앞다리" ↔ "돼지고기"처럼 한쪽이 다른 쪽을 포함하면 같은 재료로 본다.
// 단, 짧은 쪽이 1글자면("파" vs "양파") 정확히 같을 때만 인정.
// 이름에 다른 재료 이름이 들어 있어도 별개인 재료 ('순두부'는 '두부'가 아님)
// 한쪽 이름에만 이 단어가 있으면 같은 재료로 보지 않는다. 필요하면 여기에 추가.
const SEPARATE_NAMES = ['순두부', '유자당근샐러드소스', '참치액'].map(normalize);

function namesMatch(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (SEPARATE_NAMES.some((w) => x.includes(w) !== y.includes(w))) return false;
  const shorter = x.length <= y.length ? x : y;
  const longer = shorter === x ? y : x;
  return shorter.length >= 2 && longer.includes(shorter);
}

function isUrl(str) {
  return /^https?:\/\/\S+$/i.test(String(str).trim());
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- 저장 (서버의 data.json) ----------
let saveChain = Promise.resolve();

function save() {
  const status = $('#save-status');
  status.className = 'save-status';
  status.textContent = '저장 중…';
  const body = JSON.stringify(state);
  saveChain = saveChain
    .then(() => fetch('/api/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }))
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      status.textContent = '✓ 저장됨';
    })
    .catch((err) => {
      status.className = 'save-status error';
      status.textContent = '⚠ 저장 실패 — 서버가 실행 중인지 확인하세요';
      console.error(err);
    });
}

async function load() {
  try {
    const res = await fetch('/api/data', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.ingredients = data.ingredients || [];
    state.recipes = data.recipes || [];
    state.weekPlan = data.weekPlan || [];
  } catch (err) {
    const status = $('#save-status');
    status.className = 'save-status error';
    status.textContent = '⚠ 데이터를 불러오지 못했어요. 터미널에서 npm start로 서버를 실행했는지 확인하세요';
    console.error(err);
  }
}

// ---------- 추천 로직 ----------
// '기한 지난 재료도 추천에 포함' 설정 (이 브라우저에만 기억, 기본값: 포함)
const INCLUDE_EXPIRED_KEY = 'homeRecipe.includeExpired';
let includeExpired = true;
try { includeExpired = localStorage.getItem(INCLUDE_EXPIRED_KEY) !== 'false'; } catch {}

// '양념·소스는 기한이 지나도 그대로 사용' 설정 (이 브라우저에만 기억, 기본값: 켜짐)
const SAUCE_CATEGORY = '양념·소스';
const SAUCE_EXEMPT_KEY = 'homeRecipe.sauceExempt';
let sauceExempt = true;
try { sauceExempt = localStorage.getItem(SAUCE_EXEMPT_KEY) !== 'false'; } catch {}

function isExemptExpired(ing) {
  return sauceExempt && ing.category === SAUCE_CATEGORY && daysLeft(ing.expiryDate) < 0;
}

// 추천·알림에 쓰는 남은 일수. 기한 지남에서 제외된 소스는 '기한 모름'처럼 취급
function ingDays(ing) {
  return isExemptExpired(ing) ? Infinity : daysLeft(ing.expiryDate);
}

function availableIngredients() {
  return includeExpired ? state.ingredients : state.ingredients.filter((i) => ingDays(i) >= 0);
}

// 기한이 지난 재료는 D-0~1과 같은 보너스를 받아 빨리 쓰도록 추천된다
function urgencyBonus(days) {
  if (days <= 1) return 15;
  if (days <= 3) return 10;
  if (days <= 7) return 5;
  return 0;
}

function findOwned(name, available) {
  // 같은 이름의 재료가 여러 개면 소비기한이 가장 임박한 것을 쓴다
  return available
    .filter((ing) => namesMatch(ing.name, name))
    .sort((a, b) => compareDates(a.expiryDate, b.expiryDate))[0];
}

function analyzeRecipe(recipe, available) {
  const have = [];
  const missing = [];
  const usedIds = new Set();
  let urgency = 0;
  let requiredTotal = 0;
  let requiredHave = 0;
  let optionalHave = 0;

  for (const item of recipe.ingredients) {
    if (!item.optional) requiredTotal++;
    const owned = findOwned(item.name, available);
    if (!owned) {
      missing.push(item);
      continue;
    }
    const days = ingDays(owned);
    have.push({ ...item, owned, days, expired: days < 0, urgent: days >= 0 && days <= SOON_DAYS });
    if (item.optional) optionalHave++;
    else requiredHave++;
    if (!usedIds.has(owned.id)) {
      usedIds.add(owned.id);
      urgency += urgencyBonus(days);
    }
  }

  const ratio = requiredTotal ? requiredHave / requiredTotal : (recipe.ingredients.length ? optionalHave / recipe.ingredients.length : 0);
  const score = ratio * 70 + urgency + optionalHave * 2;
  return { recipe, have, missing, ratio, requiredTotal, requiredHave, urgency, score };
}

function getRecommendations() {
  const available = availableIngredients();
  return state.recipes
    .map((r) => analyzeRecipe(r, available))
    .filter((a) => a.have.length > 0)
    .sort((a, b) => b.score - a.score || a.missing.length - b.missing.length);
}

// ---------- 렌더링: 오늘의 추천 ----------
function chipsHtml(items, cls, nameOf = (i) => i.name) {
  return items.map((i) => `<span class="chip ${cls}${i.optional ? ' opt' : ''}">${esc(nameOf(i))}</span>`).join('');
}

function ingGroupsHtml(a) {
  const expired = a.have.filter((h) => h.expired);
  const urgent = a.have.filter((h) => h.urgent);
  const normal = a.have.filter((h) => !h.urgent && !h.expired);
  const rows = [];
  if (expired.length) rows.push(`<div class="ing-group"><span class="g-label">⛔ 기한 지남</span>${chipsHtml(expired, 'expired', (h) => `${h.name} ${ddayLabel(h.days)}`)}</div>`);
  if (urgent.length) rows.push(`<div class="ing-group"><span class="g-label">⚠️ 임박</span>${chipsHtml(urgent, 'urgent', (h) => `${h.name} ${ddayLabel(h.days)}`)}</div>`);
  if (normal.length) rows.push(`<div class="ing-group"><span class="g-label">✅ 보유</span>${chipsHtml(normal, 'have')}</div>`);
  if (a.missing.length) rows.push(`<div class="ing-group"><span class="g-label">❌ 부족</span>${chipsHtml(a.missing, 'missing')}</div>`);
  return `<div class="ing-groups">${rows.join('')}</div>`;
}

function reasonText(a) {
  const parts = [];
  if (a.requiredTotal) parts.push(`필수 재료 ${a.requiredTotal}개 중 ${a.requiredHave}개 보유`);
  const urgent = a.have.filter((h) => h.urgent);
  const expired = a.have.filter((h) => h.expired);
  if (urgent.length) parts.push(`곧 상하는 ${urgent.map((u) => u.name).join(', ')}을(를) 쓸 수 있어요`);
  if (expired.length) parts.push(`기한이 지난 ${expired.map((u) => u.name).join(', ')}은(는) 상태를 확인하고 써 주세요`);
  if (!urgent.length && !expired.length && !a.missing.some((m) => !m.optional)) parts.push('지금 바로 만들 수 있어요');
  return parts.join(' · ');
}

function renderToday() {
  const recs = getRecommendations();
  const soon = state.ingredients
    .filter((i) => { const d = ingDays(i); return d >= 0 && d <= SOON_DAYS; })
    .sort((a, b) => compareDates(a.expiryDate, b.expiryDate));
  const expired = state.ingredients.filter((i) => ingDays(i) < 0);

  const notes = [];
  if (soon.length) notes.push(`⏰ 소비기한 임박: <strong>${soon.map((i) => `${esc(i.name)}(${ddayLabel(ingDays(i))})`).join(', ')}</strong>`);
  if (expired.length) {
    notes.push(includeExpired
      ? `⛔ 기한 지난 재료: <strong>${expired.map((i) => esc(i.name)).join(', ')}</strong> — 추천에 포함했어요. 상태를 꼭 확인하세요`
      : `🗑️ 기한이 지난 재료 ${expired.length}개는 추천에서 제외했어요`);
  }
  $('#include-expired').checked = includeExpired;
  $('#sauce-exempt').checked = sauceExempt;
  $('#expiring-summary').innerHTML = notes.length ? `<div class="expiring-box">${notes.join('<br>')}</div>` : '';

  $('#btn-shuffle').hidden = recs.length < 2;
  if (!recs.length) {
    const why = !state.ingredients.length
      ? '냉장고 탭에서 가지고 있는 재료를 먼저 등록해 주세요.'
      : !state.recipes.length
        ? '레시피 탭에서 레시피를 먼저 등록해 주세요.'
        : '보유 재료로 만들 수 있는 레시피가 없어요. 재료나 레시피를 더 등록해 보세요.';
    $('#today-pick').innerHTML = `<div class="empty">🍽️ ${why}</div>`;
    $('#ranking').innerHTML = '';
    $('#ranking-title').hidden = true;
    return;
  }

  // '다른 추천 보기'는 상위 5개 안에서 돌아가며 보여준다
  const pool = Math.min(5, recs.length);
  const idx = pickOffset % pool;
  const pick = recs[idx];
  $('#today-pick').innerHTML = `
    <article class="pick">
      <div class="label">${idx === 0 ? '🏆 오늘의 추천' : `✨ 다른 추천 (${idx + 1}위)`}</div>
      <h3>${esc(pick.recipe.name)}</h3>
      <p class="reason">${esc(reasonText(pick))}</p>
      ${ingGroupsHtml(pick)}
      <ol class="pick-steps">${pick.recipe.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <div class="dialog-actions">
        <button class="btn ghost small" data-open-recipe="${pick.recipe.id}">레시피 자세히 보기</button>
        ${weekButtonHtml(pick.recipe.id, 'small')}
      </div>
    </article>`;

  const rest = recs.filter((_, i) => i !== idx);
  $('#ranking-title').hidden = !rest.length;
  $('#ranking').innerHTML = rest.map((a) => {
    const rank = recs.indexOf(a) + 1;
    const urgent = a.have.filter((h) => h.urgent).length;
    const expired = a.have.filter((h) => h.expired).length;
    const missingReq = a.missing.filter((m) => !m.optional);
    const sub = [
      expired ? `⛔ 기한 지난 재료 ${expired}개 사용` : '',
      urgent ? `⚠️ 임박 재료 ${urgent}개 사용` : '',
      missingReq.length ? `❌ ${missingReq.map((m) => m.name).join(', ')} 필요` : '✅ 바로 가능',
    ].filter(Boolean).join(' · ');
    return `
      <li class="rank-item" data-open-recipe="${a.recipe.id}">
        <span class="rank-num">${rank}</span>
        <div class="body">
          <div class="title">${esc(a.recipe.name)}</div>
          <div class="sub">${esc(sub)}</div>
        </div>
        <span class="match">${Math.round(a.ratio * 100)}%</span>
      </li>`;
  }).join('');
}

// ---------- 렌더링: 냉장고 ----------
// 검색어로 이름을 거르는 함수. 입력 그대로도, 동의어로 바꾼 이름으로도 찾는다
// ('파' 검색 시 양파·대파 모두, '계란' 검색 시 달걀도). 검색어가 없으면 null
function searchMatcher(query) {
  const raw = compact(query);
  if (!raw) return null;
  const q = normalize(raw);
  return (name) => compact(name).includes(raw) || normalize(name).includes(q);
}

function renderIngredients() {
  const sort = $('#ing-sort').value;
  const fStorage = $('#ing-filter-storage').value;
  const fCategory = $('#ing-filter-category').value;
  const hit = searchMatcher($('#ing-search').value);

  const list = state.ingredients
    .filter((i) => (!fStorage || i.storage === fStorage) && (!fCategory || i.category === fCategory))
    .filter((i) => !hit || hit(i.name))
    .sort((a, b) => {
      if (sort === 'purchase') return compareDates(a.purchaseDate, b.purchaseDate, true);
      if (sort === 'name') return a.name.localeCompare(b.name, 'ko');
      return compareDates(a.expiryDate, b.expiryDate);
    });

  if (!list.length) {
    $('#ingredient-list').innerHTML = `<li class="empty">${state.ingredients.length ? '조건에 맞는 재료가 없어요.' : '🥬 아직 등록된 재료가 없어요. 장 본 재료를 등록해 보세요!'}</li>`;
    return;
  }
  $('#ingredient-list').innerHTML = list.map((i) => {
    const days = daysLeft(i.expiryDate);
    const exempt = isExemptExpired(i);
    return `
      <li class="ingredient ${days < 0 && !exempt ? 'expired' : ''}">
        <span class="dday ${exempt ? '' : ddayClass(days)}" ${exempt ? 'title="양념·소스는 기한 지남에서 제외 중"' : ''}>${ddayLabel(days)}</span>
        <div class="info">
          <div class="name">${esc(i.name)}${i.quantity ? `<span class="qty">${esc(i.quantity)}</span>` : ''}</div>
          <div class="meta">
            <span class="tag">${esc(i.category)}</span>
            <span>${STORAGE_ICON[i.storage] || ''} ${esc(i.storage)}</span>
            <span>구매 ${formatDate(i.purchaseDate)} · 기한 ${formatDate(i.expiryDate)}</span>
          </div>
        </div>
        <button class="icon-btn" title="수정" data-edit-ing="${i.id}">✏️</button>
        <button class="icon-btn" title="삭제" data-del-ing="${i.id}">🗑️</button>
      </li>`;
  }).join('');
}

// ---------- 렌더링: 레시피 ----------
function renderRecipes() {
  const hit = searchMatcher($('#recipe-search').value);
  const list = state.recipes.filter((r) => !hit || hit(r.name) || r.ingredients.some((i) => hit(i.name)));

  if (!list.length) {
    $('#recipe-list').innerHTML = `<div class="empty">${state.recipes.length ? '검색 결과가 없어요.' : '📖 아직 등록된 레시피가 없어요.'}</div>`;
    return;
  }
  const available = availableIngredients();
  $('#recipe-list').innerHTML = list.map((r) => {
    const chips = r.ingredients.map((item) => {
      const has = !!findOwned(item.name, available);
      return `<span class="chip ${has ? 'have' : ''}${item.optional ? ' opt' : ''}">${esc(item.name)}</span>`;
    }).join('');
    return `
      <div class="recipe-card" data-open-recipe="${r.id}" role="button" tabindex="0">
        <div class="card-head">
          <h3>${esc(r.name)}</h3>
          ${inWeek(r.id)
            ? `<button class="btn small in-week" data-week-toggle="${r.id}" title="이번 주에서 빼기">✓ 담김</button>`
            : `<button class="btn small ghost" data-week-toggle="${r.id}" title="이번 주 메뉴에 담기">담기</button>`}
        </div>
        <div class="chips">${chips}</div>
        ${r.source ? `<div class="src">출처: ${esc(r.source)}</div>` : ''}
      </div>`;
  }).join('');
}

// ---------- 이번 주 먹을 레시피 ----------
function inWeek(recipeId) {
  return state.weekPlan.some((p) => p.recipeId === recipeId);
}

function weekButtonHtml(recipeId, size = '') {
  return inWeek(recipeId)
    ? `<button class="btn ${size} in-week" data-week-toggle="${recipeId}">✓ 이번 주에 담김</button>`
    : `<button class="btn ${size} primary" data-week-toggle="${recipeId}">📅 이번 주에 담기</button>`;
}

function toggleWeek(recipeId) {
  const r = state.recipes.find((x) => x.id === recipeId);
  if (!r) return;
  if (inWeek(recipeId)) {
    state.weekPlan = state.weekPlan.filter((p) => p.recipeId !== recipeId);
    toast(`${r.name}을(를) 이번 주에서 뺐어요`);
  } else {
    state.weekPlan.push({ id: newId(), recipeId, day: '', done: false });
    toast(`${r.name}을(를) 이번 주에 담았어요`);
  }
  save();
  renderAll();
  if ($('#recipe-detail').open && viewingRecipeId === recipeId) updateDetailWeekButton();
}

function updateDetailWeekButton() {
  const btn = $('#btn-toggle-week');
  const on = inWeek(viewingRecipeId);
  btn.textContent = on ? '✓ 이번 주에 담김' : '📅 이번 주에 담기';
  btn.className = `btn ${on ? 'in-week' : 'primary'}`;
}

function renderWeek() {
  const plan = state.weekPlan
    .map((p) => ({ ...p, recipe: state.recipes.find((r) => r.id === p.recipeId) }))
    .filter((p) => p.recipe);
  const remaining = plan.filter((p) => !p.done);

  const badge = $('#week-count');
  badge.hidden = !remaining.length;
  badge.textContent = remaining.length;
  $('#btn-clear-done').hidden = !plan.some((p) => p.done);
  $('#btn-clear-week').hidden = !plan.length;

  if (!plan.length) {
    $('#week-list').innerHTML = '<div class="empty">📅 아직 담은 레시피가 없어요.<br>오늘의 추천이나 레시피 상세에서 「이번 주에 담기」를 눌러 보세요.</div>';
    $('#shopping-title').hidden = true;
    $('#shopping-list').innerHTML = '';
    return;
  }

  const available = availableIngredients();
  const analyses = new Map(plan.map((p) => [p.id, analyzeRecipe(p.recipe, available)]));
  const today = todayDayName();
  const dayOptions = (sel) => ['', ...DAYS]
    .map((d) => `<option value="${d}" ${d === sel ? 'selected' : ''}>${d ? `${d}요일` : '요일 미정'}</option>`).join('');

  $('#week-list').innerHTML = [...DAYS, ''].map((day) => {
    const items = plan.filter((p) => (p.day || '') === day);
    if (!items.length) return '';
    const rows = items.map((p) => {
      const a = analyses.get(p.id);
      const missingReq = a.missing.filter((m) => !m.optional);
      const urgent = a.have.filter((h) => h.urgent);
      const sub = [
        missingReq.length ? `❌ ${missingReq.map((m) => m.name).join(', ')} 필요` : '✅ 재료 준비됨',
        urgent.length ? `⚠️ ${urgent.map((h) => `${h.name} ${ddayLabel(h.days)}`).join(', ')}` : '',
      ].filter(Boolean).join(' · ');
      return `
        <li class="week-item ${p.done ? 'done' : ''}">
          <input type="checkbox" data-week-done="${p.id}" ${p.done ? 'checked' : ''} title="먹었어요">
          <div class="body" data-open-recipe="${p.recipeId}">
            <div class="title">${esc(p.recipe.name)}</div>
            <div class="sub">${esc(sub)}</div>
          </div>
          <select data-week-day="${p.id}" aria-label="요일">${dayOptions(p.day || '')}</select>
          <button class="icon-btn" title="이번 주에서 빼기" data-week-remove="${p.id}">✕</button>
        </li>`;
    }).join('');
    const title = day ? `${day}요일${day === today ? ' · 오늘' : ''}` : '요일 미정';
    return `<div class="week-day ${day && day === today ? 'today' : ''}"><h3>${title}</h3><ul class="week-list">${rows}</ul></div>`;
  }).join('');

  // 아직 안 먹은 레시피에 부족한 재료를 모아 장보기 목록으로
  const shopping = new Map();
  for (const p of remaining) {
    for (const m of analyses.get(p.id).missing) {
      const key = normalize(m.name);
      const entry = shopping.get(key) || { name: m.name, optional: true, recipes: [] };
      entry.optional = entry.optional && m.optional;
      if (!entry.recipes.includes(p.recipe.name)) entry.recipes.push(p.recipe.name);
      shopping.set(key, entry);
    }
  }
  const items = [...shopping.values()].sort((a, b) => a.optional - b.optional || a.name.localeCompare(b.name, 'ko'));
  $('#shopping-title').hidden = false;
  $('#shopping-list').innerHTML = items.length
    ? `<div class="shopping"><ul>${items.map((i) => `
        <li>
          <span class="${i.optional ? 'opt-name' : ''}">${esc(i.name)}${i.optional ? ' (선택)' : ''}</span>
          <span class="for">${esc(i.recipes.join(', '))}</span>
        </li>`).join('')}</ul></div>`
    : `<div class="empty">${remaining.length ? '🎉 필요한 재료가 모두 있어요!' : '이번 주 레시피를 모두 먹었어요 👏'}</div>`;
}

function updateWeekEntry(id, changes) {
  const entry = state.weekPlan.find((p) => p.id === id);
  if (!entry) return;
  Object.assign(entry, changes);
  save();
  renderAll();
}

function renderAll() {
  renderToday();
  renderWeek();
  renderIngredients();
  renderRecipes();
}

// ---------- 재료 등록/수정 ----------
function openIngredientDialog(id = null) {
  editingIngredientId = id;
  const form = $('#ingredient-form');
  form.reset();
  const ing = id ? state.ingredients.find((i) => i.id === id) : null;
  $('#ingredient-dialog-title').textContent = ing ? '재료 수정' : '재료 등록';
  form.name.value = ing?.name || '';
  form.category.value = ing?.category || CATEGORIES[0];
  form.quantity.value = ing?.quantity || '';
  form.purchaseDate.value = toInputDate(ing ? ing.purchaseDate : todayStr());
  form.expiryDate.value = toInputDate(ing?.expiryDate || '');
  // 기존 재료에서 날짜가 비어 있으면 '모름'으로 저장된 것
  setDateUnknown(form, 'purchaseDate', !!ing && !ing.purchaseDate);
  setDateUnknown(form, 'expiryDate', !!ing && !ing.expiryDate);
  form.storage.value = ing?.storage || '냉장';
  $('#ingredient-dialog').showModal();
  form.name.focus();
}

function setDateUnknown(form, field, unknown) {
  const input = form[field];
  form.querySelector(`[data-unknown-for="${field}"]`).checked = unknown;
  input.disabled = unknown;
  input.required = !unknown;
  form.querySelector(`[data-pick-for="${field}"]`).disabled = unknown;
  if (unknown) input.value = '';
  else if (field === 'purchaseDate' && !input.value) input.value = toInputDate(todayStr());
}

function submitIngredient(e) {
  e.preventDefault();
  const form = e.target;
  const data = {
    name: form.name.value.trim(),
    category: form.category.value,
    quantity: form.quantity.value.trim(),
    purchaseDate: '',
    expiryDate: '',
    storage: form.storage.value,
  };
  if (!data.name) return;
  for (const [field, label] of [['purchaseDate', '구매 일자를'], ['expiryDate', '소비 기한을']]) {
    if (form[field].disabled) continue; // '모름'
    const iso = fromInputDate(form[field].value);
    if (!iso) {
      toast(`${label} YYYY/MM/DD 형식으로 입력해 주세요 (예: 2026/10/09)`);
      form[field].focus();
      return;
    }
    data[field] = iso;
  }
  if (data.purchaseDate && data.expiryDate && data.expiryDate < data.purchaseDate) {
    toast('소비 기한이 구매 일자보다 빠를 수 없어요');
    return;
  }
  if (editingIngredientId) {
    Object.assign(state.ingredients.find((i) => i.id === editingIngredientId), data);
    toast(`${data.name} 수정 완료`);
  } else {
    state.ingredients.push({ id: newId(), ...data });
    toast(`${data.name} 등록 완료`);
  }
  $('#ingredient-dialog').close();
  save();
  renderAll();
}

function deleteIngredient(id) {
  const ing = state.ingredients.find((i) => i.id === id);
  if (!ing || !confirm(`'${ing.name}'을(를) 삭제할까요?`)) return;
  state.ingredients = state.ingredients.filter((i) => i.id !== id);
  save();
  renderAll();
}

// ---------- 레시피 등록/수정 ----------
// after가 주어지면 그 재료 바로 다음에 끼워 넣는다
function addRecipeIngRow(item = { name: '', optional: false }, after = null) {
  const li = document.createElement('li');
  li.innerHTML = `
    <input type="text" list="owned-names" placeholder="재료 이름 (Enter로 다음 재료)" value="${esc(item.name)}">
    <label class="opt-toggle"><input type="checkbox" ${item.optional ? 'checked' : ''}> 선택</label>
    <button type="button" class="icon-btn" title="삭제" data-remove-row>✕</button>`;
  if (after) after.after(li);
  else $('#recipe-ing-rows').appendChild(li);
  return li;
}

// after가 주어지면 그 단계 바로 다음에 끼워 넣는다
function addStepRow(text = '', after = null) {
  const li = document.createElement('li');
  li.innerHTML = `
    <textarea rows="1" placeholder="조리 과정 (Enter로 다음 단계)">${esc(text)}</textarea>
    <button type="button" class="icon-btn" title="삭제" data-remove-row>✕</button>`;
  if (after) after.after(li);
  else $('#recipe-step-rows').appendChild(li);
  return li;
}

function updateOwnedDatalist() {
  let dl = $('#owned-names');
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = 'owned-names';
    document.body.appendChild(dl);
  }
  const names = [...new Set(state.ingredients.map((i) => i.name))];
  dl.innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
}

function openRecipeDialog(id = null) {
  editingRecipeId = id;
  const form = $('#recipe-form');
  form.reset();
  const r = id ? state.recipes.find((x) => x.id === id) : null;
  $('#recipe-dialog-title').textContent = r ? '레시피 수정' : '레시피 등록';
  form.name.value = r?.name || '';
  form.source.value = r?.source || '';
  form.memo.value = r?.memo || '';
  $('#recipe-ing-rows').innerHTML = '';
  $('#recipe-step-rows').innerHTML = '';
  (r?.ingredients.length ? r.ingredients : [{ name: '', optional: false }, { name: '', optional: false }]).forEach((item) => addRecipeIngRow(item));
  (r?.steps.length ? r.steps : ['']).forEach((text) => addStepRow(text));
  updateOwnedDatalist();
  $('#recipe-dialog').showModal();
  form.name.focus();
}

function submitRecipe(e) {
  e.preventDefault();
  const form = e.target;
  const ingredients = [...$('#recipe-ing-rows').children]
    .map((li) => ({ name: li.querySelector('input[type="text"]').value.trim(), optional: li.querySelector('input[type="checkbox"]').checked }))
    .filter((i) => i.name);
  const steps = [...$('#recipe-step-rows').querySelectorAll('textarea')].map((t) => t.value.trim()).filter(Boolean);
  if (!ingredients.length) return toast('필요한 재료를 1개 이상 입력해 주세요');
  if (!steps.length) return toast('요리 순서를 1단계 이상 입력해 주세요');

  const data = { name: form.name.value.trim(), ingredients, steps, source: form.source.value.trim(), memo: form.memo.value.trim() };
  if (editingRecipeId) {
    Object.assign(state.recipes.find((r) => r.id === editingRecipeId), data);
    toast(`${data.name} 수정 완료`);
  } else {
    state.recipes.push({ id: newId(), ...data });
    toast(`${data.name} 등록 완료`);
  }
  $('#recipe-dialog').close();
  save();
  renderAll();
}

function openRecipeDetail(id) {
  const r = state.recipes.find((x) => x.id === id);
  if (!r) return;
  viewingRecipeId = id;
  const available = availableIngredients();
  const a = analyzeRecipe(r, available);
  const source = r.source
    ? `출처: ${isUrl(r.source) ? `<a href="${esc(r.source)}" target="_blank" rel="noopener noreferrer">${esc(r.source)}</a>` : esc(r.source)}`
    : '';
  updateDetailWeekButton();
  $('#recipe-detail-body').innerHTML = `
    <div class="detail">
      <h2>${esc(r.name)}</h2>
      ${source ? `<div class="src">${source}</div>` : ''}
      <h3>재료</h3>
      ${ingGroupsHtml(a)}
      <h3>요리 순서</h3>
      <ol>${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      ${r.memo ? `<h3>메모</h3><div class="memo">${esc(r.memo)}</div>` : ''}
    </div>`;
  $('#recipe-detail').showModal();
}

function deleteRecipe(id) {
  const r = state.recipes.find((x) => x.id === id);
  if (!r || !confirm(`'${r.name}' 레시피를 삭제할까요?`)) return;
  state.recipes = state.recipes.filter((x) => x.id !== id);
  state.weekPlan = state.weekPlan.filter((p) => p.recipeId !== id);
  $('#recipe-detail').close();
  save();
  renderAll();
}

// ---------- 이벤트 ----------
function bindEvents() {
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab.dataset.tab}`));
  }));

  $('#include-expired').addEventListener('change', (e) => {
    includeExpired = e.target.checked;
    try { localStorage.setItem(INCLUDE_EXPIRED_KEY, String(includeExpired)); } catch {}
    pickOffset = 0;
    renderAll();
  });
  $('#sauce-exempt').addEventListener('change', (e) => {
    sauceExempt = e.target.checked;
    try { localStorage.setItem(SAUCE_EXEMPT_KEY, String(sauceExempt)); } catch {}
    pickOffset = 0;
    renderAll();
  });
  $('#btn-shuffle').addEventListener('click', () => { pickOffset++; renderToday(); });
  $('#btn-add-ingredient').addEventListener('click', () => openIngredientDialog());
  $('#btn-add-recipe').addEventListener('click', () => openRecipeDialog());
  $('#ingredient-form').addEventListener('submit', submitIngredient);
  $('#ingredient-form').addEventListener('change', (e) => {
    const form = e.currentTarget;
    const { unknownFor, nativeFor } = e.target.dataset;
    if (unknownFor) setDateUnknown(form, unknownFor, e.target.checked);
    else if (nativeFor && e.target.value) form[nativeFor].value = toInputDate(e.target.value);
  });
  $('#ingredient-form').addEventListener('input', (e) => {
    if (e.target.name === 'purchaseDate' || e.target.name === 'expiryDate') autoSlashDate(e.target, e);
  });
  // 📅 버튼: 숨겨진 기본 날짜 선택기를 열고, 고른 날짜를 YYYY/MM/DD로 채운다
  $('#ingredient-form').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick-for]');
    if (!btn) return;
    const field = btn.dataset.pickFor;
    const native = e.currentTarget.querySelector(`[data-native-for="${field}"]`);
    native.value = fromInputDate(e.currentTarget[field].value) || '';
    try { native.showPicker(); } catch { native.focus(); native.click(); }
  });
  $('#recipe-form').addEventListener('submit', submitRecipe);
  $('#btn-add-recipe-ing').addEventListener('click', () => addRecipeIngRow().querySelector('input').focus());
  $('#btn-add-step').addEventListener('click', () => addStepRow().querySelector('textarea').focus());
  // 요리 순서: Enter → 다음 단계 추가, Shift+Enter → 줄바꿈
  // 한글 입력 중(조합 중)의 Enter는 글자 확정용이므로 무시한다
  $('#recipe-step-rows').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    if (e.target.tagName !== 'TEXTAREA') return;
    e.preventDefault();
    if (!e.target.value.trim()) return;
    addStepRow('', e.target.closest('li')).querySelector('textarea').focus();
  });
  // 필요한 재료: Enter → 다음 재료 칸으로 (바로 아래가 빈 칸이면 그리로, 아니면 새 칸 추가)
  // Enter가 레시피 저장(폼 제출)으로 이어지지 않도록 항상 막는다
  $('#recipe-ing-rows').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.type !== 'text') return;
    e.preventDefault();
    if (e.isComposing || e.keyCode === 229 || !e.target.value.trim()) return;
    const li = e.target.closest('li');
    const nextInput = li.nextElementSibling?.querySelector('input[type="text"]');
    (nextInput && !nextInput.value.trim() ? nextInput : addRecipeIngRow(undefined, li).querySelector('input')).focus();
  });
  $('#btn-edit-recipe').addEventListener('click', () => { $('#recipe-detail').close(); openRecipeDialog(viewingRecipeId); });
  $('#btn-delete-recipe').addEventListener('click', () => deleteRecipe(viewingRecipeId));
  $('#btn-toggle-week').addEventListener('click', () => toggleWeek(viewingRecipeId));
  $('#btn-clear-done').addEventListener('click', () => {
    state.weekPlan = state.weekPlan.filter((p) => !p.done);
    save();
    renderAll();
  });
  $('#btn-clear-week').addEventListener('click', () => {
    if (!confirm('이번 주 레시피를 모두 비울까요?')) return;
    state.weekPlan = [];
    save();
    renderAll();
  });
  $('#week-list').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.weekDone) updateWeekEntry(t.dataset.weekDone, { done: t.checked });
    else if (t.dataset.weekDay) updateWeekEntry(t.dataset.weekDay, { day: t.value });
  });
  ['#ing-sort', '#ing-filter-storage', '#ing-filter-category'].forEach((s) => $(s).addEventListener('change', renderIngredients));
  $('#ing-search').addEventListener('input', renderIngredients);
  $('#recipe-search').addEventListener('input', renderRecipes);
  // 카드가 button이 아니므로 키보드(Enter/Space)로도 열 수 있게
  $('#recipe-list').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.recipe-card')) {
      e.preventDefault();
      openRecipeDetail(e.target.dataset.openRecipe);
    }
  });

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-close], [data-remove-row], [data-edit-ing], [data-del-ing], [data-week-toggle], [data-week-remove], [data-open-recipe]');
    if (!t) return;
    if (t.matches('[data-close]')) t.closest('dialog').close();
    else if (t.matches('[data-remove-row]')) t.closest('li').remove();
    else if (t.dataset.editIng) openIngredientDialog(t.dataset.editIng);
    else if (t.dataset.delIng) deleteIngredient(t.dataset.delIng);
    else if (t.dataset.weekToggle) toggleWeek(t.dataset.weekToggle);
    else if (t.dataset.weekRemove) {
      state.weekPlan = state.weekPlan.filter((p) => p.id !== t.dataset.weekRemove);
      save();
      renderAll();
    }
    else if (t.dataset.openRecipe) openRecipeDetail(t.dataset.openRecipe);
  });

  // 다이얼로그 바깥(배경) 클릭 시 닫기
  document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  }));

  // 날짜가 바뀌면(자정이 지나면) D-day 갱신
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderAll(); });
}

function fillSelects() {
  const opts = (arr) => arr.map((v) => `<option value="${v}">${v}</option>`).join('');
  $('#ingredient-form').category.innerHTML = opts(CATEGORIES);
  $('#ing-filter-category').insertAdjacentHTML('beforeend', opts(CATEGORIES));
  $('#ing-filter-storage').insertAdjacentHTML('beforeend', opts(STORAGES));
}

(async function init() {
  fillSelects();
  bindEvents();
  await load();
  renderAll();
})();
