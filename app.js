/* 사서 선생님의 프롬프트 서가 — 동작부
   저장되는 것: 밝기, 담아둔 것, 채워둔 값. 모두 이 브라우저 안에만 남습니다. */

'use strict';

const LS = {
  get(k, d) { try { const v = localStorage.getItem('seoga.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('seoga.' + k, JSON.stringify(v)); } catch (e) {} }
};

const state = {
  cat: 'all',
  q: '',
  chip: null,
  favOnly: false,
  favs: LS.get('favs', []),
  vals: LS.get('vals', {}),
  open: null
};

/* ── 유틸 ───────────────────────────────────────────── */

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const catOf = id => CATS.find(c => c.id === id) || { name: '', sub: '', glyph: '' };
const byId = id => PROMPTS.find(p => p.id === id);

let toastT;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('on'), 2100);
}

async function copy(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-2000px;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e2) { toast('복사가 막혔습니다. 직접 선택해 주십시오.'); ta.remove(); return; }
    ta.remove();
  }
  toast(msg || '복사했습니다');
}

/* ── 변수 파싱 ──────────────────────────────────────── */

/* AI에게 남기라고 지시한 표시들. 사용자가 채울 칸이 아닙니다. */
const NOT_VAR = new Set([
  '확인필요', '확인 필요', '지침 확인', '법령 확인', '근거 확인', '기재요령 확인',
  '내용 확인', '내용 확인 필요', '작성 필요', '불명확', ' ', ''
]);

const VAR_RE = /\[([^\[\]\n]{0,60})\]/g;

function varsOf(body) {
  const seen = new Set();
  const out = [];
  let m;
  VAR_RE.lastIndex = 0;
  while ((m = VAR_RE.exec(body))) {
    const raw = m[1];
    if (NOT_VAR.has(raw.trim()) || !raw.trim()) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    const lineStart = body.lastIndexOf('\n', m.index - 1) + 1;
    out.push(parseVar(
      raw,
      body.slice(lineStart, m.index),
      body.slice(m.index + m[0].length, m.index + m[0].length + 8)
    ));
  }
  return out;
}

const trim13 = s => { s = String(s).trim(); return s.length > 13 ? s.slice(0, 13) + '…' : s; };

/* "- 학교급: [초 / 중 / 고]" 처럼 앞에 놓인 항목명을 이름표로 씁니다. */
function leadLabel(before) {
  const m = before.match(/([^\n]*?):[\s총약]{0,3}$/);
  if (!m) return '';
  let s = m[1];
  const rb = s.lastIndexOf(']');
  if (rb > -1) s = s.slice(rb + 1);
  s = s.replace(/\s*[(（—].*$/, '');
  s = s.replace(/^[\s\-•◦*·/]+/, '').replace(/^\d+[.)]\s*/, '').trim();
  return s.length > 13 ? '' : s;
}

function parseVar(raw, before, after) {
  let label = '', source = raw;

  const ci = raw.indexOf(':');
  if (ci > 0 && ci <= 12) {
    label = raw.slice(0, ci).trim();
    source = raw.slice(ci + 1).trim();
  }
  if (!label && /^[0-9NＮ%]+$/.test(raw.trim())) {
    const u = (after || '').match(/^([가-힣]{1,4})/);
    if (u) label = u[1];
  }
  if (!label) {
    const lead = leadLabel(before || '');
    if (lead && !(lead.indexOf('/') > -1 && raw.length <= 8)) label = lead;
  }
  if (!label) {
    const cut = raw.search(/[—(,·]/);
    label = cut > 1 ? raw.slice(0, cut) : raw;
  }
  label = trim13(label) || raw;

  let opts = [];
  if (source.indexOf('/') > -1) {
    const p = source.split('/').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
    if (p.length >= 2 && p.length <= 7 && p.every(x => x.length <= 26)) opts = p;
  }
  return { raw, label, hint: raw, opts };
}

function fill(body, vals, mode) {
  const src = mode === 'html' ? esc(body) : body;
  return src.replace(/\[([^\[\]\n]{0,60})\]/g, (whole, raw) => {
    const key = mode === 'html'
      ? raw.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      : raw;
    if (NOT_VAR.has(key.trim())) return whole;
    const v = vals && vals[key];
    if (mode === 'html') {
      return v ? '<mark class="filled">' + esc(v) + '</mark>' : '<mark>' + whole + '</mark>';
    }
    return v || whole;
  });
}

/* ── 서가 ───────────────────────────────────────────── */

function buildRail() {
  const rail = $('#rail');
  const mk = (id, glyph, name, sub, n) =>
    '<button class="railitem" data-cat="' + id + '" style="--cat:var(--c-' + id + ')" aria-pressed="' + (state.cat === id) + '">' +
      '<span class="railitem__n">' + glyph + '</span>' +
      '<span class="railitem__t">' + name + '</span>' +
      '<span class="railitem__s">' + sub + ' · ' + n + '편</span>' +
    '</button>';

  let html = mk('all', '—', '전체', '아홉 서가 모두', PROMPTS.length);
  CATS.forEach(c => { html += mk(c.id, c.glyph, c.name, c.sub, PROMPTS.filter(p => p.cat === c.id).length); });
  rail.innerHTML = html;

  $$('.railitem', rail).forEach(b => b.addEventListener('click', () => {
    state.cat = b.dataset.cat;
    state.favOnly = false;
    state.chip = null;
    $('#favbtn').setAttribute('aria-pressed', 'false');
    render();
    if (window.innerWidth < 900) $('#grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

function buildChips() {
  const wrap = $('#chips');
  CHIPS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = c.label;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      if (state.chip === i) { state.chip = null; state.q = ''; }
      else { state.chip = i; state.q = c.q; }
      $('#q').value = '';
      $('#qx').classList.remove('on');
      state.cat = 'all';
      state.favOnly = false;
      $('#favbtn').setAttribute('aria-pressed', 'false');
      render();
    });
    wrap.appendChild(b);
  });
}

/* ── 목록 ───────────────────────────────────────────── */

function matches(p) {
  if (state.favOnly && state.favs.indexOf(p.id) < 0) return false;
  if (state.cat !== 'all' && p.cat !== state.cat) return false;
  const q = state.q.trim().toLowerCase();
  if (!q) return true;
  const hay = [p.title, p.desc, p.tags.join(' '), catOf(p.cat).name, catOf(p.cat).sub, p.body, p.tip || '', p.care || '']
    .join(' ').toLowerCase();
  const words = q.split(/\s+/);
  /* 상황 칩은 여러 낱말 중 하나만 맞아도 되게 */
  return state.chip !== null ? words.some(w => hay.indexOf(w) > -1) : words.every(w => hay.indexOf(w) > -1);
}

function cardHTML(p) {
  const c = catOf(p.cat);
  const fav = state.favs.indexOf(p.id) > -1;
  const lv = [1, 2, 3].map(n => '<i class="' + (n <= p.level ? 'on' : '') + '"></i>').join('');
  return '<div class="card" role="button" tabindex="0" data-id="' + p.id + '" style="--cat:var(--c-' + p.cat + ')">' +
    '<span class="card__top">' +
      '<span class="card__cat">' + c.glyph + '</span>' +
      '<span class="card__badge">' + esc(c.name) + '</span>' +
      '<span class="card__lv" title="깊이 ' + p.level + '/3">' + lv + '</span>' +
    '</span>' +
    '<span class="card__t">' + esc(p.title) + '</span>' +
    '<span class="card__d">' + esc(p.desc) + '</span>' +
    '<span class="card__foot">' +
      p.tags.slice(0, 3).map(t => '<span class="tag">' + esc(t) + '</span>').join('') +
      (p.care ? '<span class="card__flag">주의 있음</span>' : '') +
    '</span>' +
    '<span class="card__fav ' + (fav ? 'on' : '') + '" data-fav="' + p.id + '" role="button" tabindex="0" aria-label="담아두기">' +
      '<svg width="15" height="15" viewBox="0 0 16 16" fill="' + (fav ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6 4.2 13.6l.7-4.3-3.1-3 4.3-.6z"/></svg>' +
    '</span>' +
  '</div>';
}

function render() {
  const list = PROMPTS.filter(matches);
  const grid = $('#grid');
  grid.innerHTML = list.map(cardHTML).join('');
  $('#empty').hidden = list.length > 0;

  const c = state.cat === 'all' ? null : catOf(state.cat);
  $('#lh-t').textContent = state.favOnly ? '담아둔 것'
    : state.chip !== null ? CHIPS[state.chip].label
    : (c ? c.name : '전체');
  $('#lh-c').textContent = list.length + '편' +
    (state.q && state.chip === null ? ' · “' + state.q + '” 검색' : '');
  $('.listhead').style.setProperty('--cat',
    'var(--c-' + (c && !state.favOnly && state.chip === null ? c.id : 'all') + ')');

  $$('.railitem').forEach(b => b.setAttribute('aria-pressed',
    String(!state.favOnly && state.chip === null && b.dataset.cat === state.cat)));
  $$('#chips .chip').forEach((b, i) => b.setAttribute('aria-pressed', String(state.chip === i)));
  $('#favcnt').textContent = state.favs.length;

  grid.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', e => {
      const f = e.target.closest('[data-fav]');
      if (f) { e.stopPropagation(); toggleFav(f.dataset.fav); return; }
      openSheet(el.dataset.id);
    });
    el.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      const f = e.target.closest('[data-fav]');
      if (f) toggleFav(f.dataset.fav); else openSheet(el.dataset.id);
    });
  });
}

function toggleFav(id) {
  const i = state.favs.indexOf(id);
  if (i > -1) { state.favs.splice(i, 1); toast('서가로 돌려두었습니다'); }
  else { state.favs.push(id); toast('담아두었습니다'); }
  LS.set('favs', state.favs);
  render();
  if (state.open === id) renderSheetFav();
}

/* ── 상세 ───────────────────────────────────────────── */

function openSheet(id) {
  const p = byId(id);
  if (!p) return;
  state.open = id;
  const c = catOf(p.cat);
  const vars = varsOf(p.body);
  const vals = state.vals[id] || {};

  $('#sheet-idx').textContent = c.glyph + ' · ' + c.name;
  $('#sheet').style.setProperty('--cat', 'var(--c-' + p.cat + ')');
  const toolLine = p.tools.map(t => (TOOLS[t] || { label: t }).label).join(' · ');

  let html =
    '<div class="doc__cat">' + c.glyph + '. ' + esc(c.name) + '</div>' +
    '<h2 class="doc__t">' + esc(p.title) + '</h2>' +
    '<p class="doc__d">' + esc(p.desc) + '</p>' +
    '<div class="doc__meta">' +
      '<span><b>어울리는 도구</b> ' + esc(toolLine) + '</span>' +
      '<span><b>깊이</b> ' + p.level + ' / 3</span>' +
      '<span><b>채울 칸</b> ' + vars.length + '개</span>' +
      '<span>' + p.tags.map(t => '#' + esc(t)).join(' ') + '</span>' +
    '</div>';

  if (vars.length) {
    html += '<div class="sech">채우기</div><div class="vars">';
    vars.forEach((v, i) => {
      const dl = v.opts.length ? 'dl-' + id + '-' + i : '';
      html += '<label class="var">' +
        '<span class="var__l">' + esc(v.label) + '</span>' +
        '<input type="text" data-var="' + esc(v.raw) + '" value="' + esc(vals[v.raw] || '') + '"' +
        ' placeholder="' + esc(v.hint) + '"' + (dl ? ' list="' + dl + '"' : '') + '>' +
      '</label>';
      if (dl) html += '<datalist id="' + dl + '">' + v.opts.map(o => '<option value="' + esc(o) + '">').join('') + '</datalist>';
    });
    html += '</div>';
  }

  html +=
    '<div class="sech">프롬프트</div>' +
    '<div class="pbox" id="pbox">' + fill(p.body, vals, 'html') + '</div>' +
    '<div class="acts">' +
      '<button class="abtn" id="pcopy">프롬프트 복사</button>' +
      (vars.length ? '<button class="abtn ghost" id="pclear">채운 값 비우기</button>' : '') +
      '<button class="abtn ghost" id="pcheck">개인정보 점검으로</button>' +
    '</div>';

  if (p.tip) {
    html += '<div class="sech">쓰는 요령</div>' +
      '<div class="note"><div class="note__h">이 프롬프트의 핵심</div><p>' + esc(p.tip) + '</p></div>';
  }
  if (p.care) {
    html += '<div class="sech">주의</div>' +
      '<div class="note warn"><div class="note__h">넣기 전에 확인하십시오</div><p>' + esc(p.care) + '</p></div>';
  }

  const nx = (p.next || []).map(byId).filter(Boolean);
  if (nx.length) {
    html += '<div class="sech">이어 쓰면 좋은 것</div><div class="nexts">' +
      nx.map(n => '<button class="nextitem" data-goto="' + n.id + '" style="--cat:var(--c-' + n.cat + ')">' +
        '<b>' + esc(n.title) + '</b><span>' + catOf(n.cat).glyph + '. ' + esc(catOf(n.cat).name) + ' · ' + esc(n.desc) + '</span>' +
      '</button>').join('') + '</div>';
  }

  if (p.source) html += '<div class="src">근거 자료 · ' + esc(p.source) + '</div>';
  html += '<div class="src">이 결과물은 초안입니다. 서지 정보·법령·수치는 원문에서 확인하시고, 최종 판단은 선생님께서 하십시오.</div>';

  $('#sheet-body').innerHTML = html;
  $('#sheet-body').scrollTop = 0;
  renderSheetFav();

  $$('#sheet-body [data-var]').forEach(inp => {
    inp.addEventListener('input', () => {
      const store = state.vals[id] || (state.vals[id] = {});
      const val = inp.value.trim();
      if (val) store[inp.dataset.var] = val; else delete store[inp.dataset.var];
      LS.set('vals', state.vals);
      $('#pbox').innerHTML = fill(p.body, state.vals[id], 'html');
    });
  });

  $('#pcopy').addEventListener('click', () => copy(fill(p.body, state.vals[id], 'text'), '프롬프트를 복사했습니다'));
  const pc = $('#pclear');
  if (pc) pc.addEventListener('click', () => {
    delete state.vals[id];
    LS.set('vals', state.vals);
    openSheet(id);
    toast('비웠습니다');
  });
  $('#pcheck').addEventListener('click', () => openModal('checker'));
  $$('#sheet-body [data-goto]').forEach(b => b.addEventListener('click', () => openSheet(b.dataset.goto)));

  $('#sheet').classList.add('on');
  $('#scrim').classList.add('on');
  document.body.style.overflow = 'hidden';
  if (history.replaceState) history.replaceState(null, '', '#' + id);
}

function renderSheetFav() {
  const on = state.favs.indexOf(state.open) > -1;
  const b = $('#sheet-fav');
  b.textContent = on ? '담아둠 ✓' : '담아두기';
  b.setAttribute('aria-pressed', String(on));
}

function closeSheet() {
  $('#sheet').classList.remove('on');
  $('#scrim').classList.remove('on');
  document.body.style.overflow = '';
  state.open = null;
  if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
}

/* ── 모달 ───────────────────────────────────────────── */

function openModal(name) {
  $('#m-' + name).classList.add('on');
  document.body.style.overflow = 'hidden';
}
function closeModals() {
  $$('.modal').forEach(m => m.classList.remove('on'));
  if (!$('#sheet').classList.contains('on')) document.body.style.overflow = '';
}

/* ── 월별 살림 ──────────────────────────────────────── */

function buildCal() {
  $('#cal').innerHTML = CAL.map(m =>
    '<div class="cal__m">' +
      '<div class="cal__n">' + m.m + '</div>' +
      '<div class="cal__h">' + m.head + '</div>' +
      '<ul class="cal__list">' + m.todo.map(t => '<li>' + t + '</li>').join('') + '</ul>' +
      '<div class="cal__picks">' + m.picks.map(id => {
        const p = byId(id);
        return p ? '<button class="cal__pick" data-goto="' + id + '" style="--cat:var(--c-' + p.cat + ')">' + esc(p.title) + '</button>' : '';
      }).join('') + '</div>' +
    '</div>').join('');
}

/* ── 저작권 ─────────────────────────────────────────── */

function buildCopyright() {
  $('#copyright').innerHTML = COPYRIGHT.map(c =>
    '<div class="cw">' +
      '<div class="cw__q">' +
        '<div class="cw__t">' + esc(c.q) + '</div>' +
        '<div class="cw__v ' + c.verdict + '">' + esc(c.vlabel) + '</div>' +
      '</div>' +
      '<p class="cw__law">' + esc(c.law) + '</p>' +
      '<div class="cw__body">' +
        '<div><div class="cw__h">확인할 것</div><ul class="cw__list">' +
          c.check.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></div>' +
        '<div><div class="cw__h">더 안전한 길</div><ul class="cw__list">' +
          c.safe.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></div>' +
      '</div>' +
    '</div>').join('');
}

/* ── 빌더 ───────────────────────────────────────────── */

const bvals = {};

function buildBuilder() {
  const wrap = $('#bfields');
  const rn = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  wrap.innerHTML = BUILDER.map((f, i) =>
    '<div class="bfield">' +
      '<div class="bfield__h">' +
        '<span class="bfield__n">' + rn[i] + '</span>' +
        '<span class="bfield__l">' + f.label + '</span>' +
        '<span class="bfield__hint">' + f.hint + '</span>' +
      '</div>' +
      '<textarea data-b="' + f.key + '" placeholder="' + esc(f.ph) + '"></textarea>' +
      '<p class="bfield__why">' + esc(f.why) + '</p>' +
    '</div>'
  ).join('');
  $$('[data-b]', wrap).forEach(t => t.addEventListener('input', () => {
    bvals[t.dataset.b] = t.value.trim();
    paintBuilder();
  }));
}

function builderText() {
  const L = [];
  if (bvals.role) L.push('당신은 ' + bvals.role + '입니다.');
  if (bvals.ctx) L.push('\n[상황]\n' + bvals.ctx);
  if (bvals.task) L.push('\n[해줄 일]\n' + bvals.task);
  if (bvals.fmt) L.push('\n[형식]\n' + bvals.fmt);
  if (bvals.cons) L.push('\n[지켜야 할 것]\n' + bvals.cons);
  if (bvals.ex) L.push('\n[기준·예시]\n' + bvals.ex);
  if (!L.length) return '';
  L.push('\n[공통]\n' +
    '- 책 제목·지은이·출판사·출간연도는 확실하지 않으면 지어내지 말고 [확인 필요]로 표시한 뒤,\n' +
    '  대신 찾을 수 있는 검색 키워드를 알려 주세요.\n' +
    '- 제가 주지 않은 사실·수치·법령 조문·참고문헌도 지어내지 마세요.\n' +
    '- 학생을 특정할 수 있는 정보가 결과물에 남지 않게 해 주세요.\n' +
    '- 먼저 어떻게 접근할지 세 줄로 설명한 뒤 본문을 작성해 주세요.');
  return L.join('\n');
}

function paintBuilder() {
  $('#bout').textContent = builderText() || '위 칸을 채우면 여기에 나타납니다.';
}

/* ── 개인정보 점검 ──────────────────────────────────── */

function runCheck() {
  const text = $('#chkin').value;
  const out = $('#chkout');
  if (!text.trim()) { out.innerHTML = ''; toast('점검할 글을 넣어 주십시오'); return; }

  const hits = [];
  PII.forEach(rule => {
    rule.re.lastIndex = 0;
    let found = text.match(rule.re);
    if (found && rule.skip) found = found.filter(x => !rule.skip.some(s => x.indexOf(s) === 0));
    if (found && found.length) {
      const uniq = Array.from(new Set(found)).slice(0, 6);
      hits.push({ label: rule.label, level: rule.level, samples: uniq, n: found.length });
    }
  });

  let html = '<div class="sech">찾은 것</div>';
  if (!hits.length) {
    html += '<div class="hit"><span class="hit__l">눈에 띄는 것 없음</span>' +
      '<span class="hit__v">형태로 잡히는 개인정보는 발견되지 않았습니다</span></div>';
  } else {
    html += '<div class="hits">' + hits.map(h =>
      '<div class="hit ' + h.level + '">' +
        '<span class="hit__l">' + h.label + '</span>' +
        '<span class="hit__v">' + esc(h.samples.join('  ·  ')) + (h.n > h.samples.length ? ' 외 ' + (h.n - h.samples.length) + '건' : '') + '</span>' +
        '<span class="hit__b">' + (h.level === 'high' ? '지우십시오' : '살펴보십시오') + '</span>' +
      '</div>').join('') + '</div>';
  }

  const high = hits.filter(h => h.level === 'high').length;
  html += '<div class="verdict ' + (high ? 'bad' : '') + '">' +
    '<div class="verdict__t">' + (high ? '이대로 넣지 마십시오' : hits.length ? '한 번 더 살펴보십시오' : '기계가 잡을 것은 없습니다') + '</div>' +
    '<p>' + (high
      ? '직접 식별정보가 남아 있습니다. 아래 “찾은 것 가리고 복사”로 치환하거나 직접 지운 뒤 넣으십시오.'
      : hits.length
        ? '형태로만 보면 큰 문제는 없습니다. 다만 기계는 <b>간접 식별정보</b>를 못 잡습니다. 도서관에서는 특히 그렇습니다 — “3학년 축구부에서 천문학 책만 빌리는 학생”은 이미 특정입니다. 그런 조합이 남아 있지 않은지 눈으로 보십시오.'
        : '다만 이 점검은 형태가 뚜렷한 것만 찾습니다. 대출 이력, 희망도서 신청 내역, 드문 관심사처럼 <b>맥락으로 사람이 드러나는 정보</b>는 선생님만 아십니다. 애매하면 빼는 쪽을 택하십시오.') +
    '</p></div>';

  out.innerHTML = html;
}

function maskText() {
  let text = $('#chkin').value;
  if (!text.trim()) { toast('가릴 글이 없습니다'); return; }
  const names = {};
  let ni = 0;
  PII.forEach(rule => {
    rule.re.lastIndex = 0;
    text = text.replace(rule.re, m => {
      if (rule.key === 'name') {
        if (rule.skip && rule.skip.some(s => m.indexOf(s) === 0)) return m;
        const mm = m.match(/^(.+?)\s*(학생|군|양|어머니|아버지|선생님|쌤|님)$/);
        const base = (mm ? mm[1] : m).trim();
        const suf = mm ? mm[2] : '';
        if (suf === '선생님' || suf === '쌤') return '○○ 선생님';
        if (suf === '어머니' || suf === '아버지') return '보호자';
        if (!names[base]) names[base] = '학생 ' + String.fromCharCode(65 + (ni++ % 26));
        return names[base] + (suf === '님' ? '님' : '');
      }
      return {
        rrn: '[주민등록번호 삭제]', phone: '[연락처 삭제]', tel: '[연락처 삭제]',
        email: '[이메일 삭제]', school: '○○학교', class: '○학년 ○반',
        addr: '○○시 ○○동', apt: '○○아파트', birth: '○○○○년 ○월 ○일',
        sid: '[학번 삭제]', barcode: '[등록번호 삭제]'
      }[rule.key] || '○○';
    });
  });
  $('#chkin').value = text;
  runCheck();
  copy(text, '가린 글을 복사했습니다. 눈으로 한 번 더 보십시오');
}

/* ── 다섯 가지 ──────────────────────────────────────── */

function buildRules() {
  $('#rules').innerHTML = RULES.map(r =>
    '<div class="rule">' +
      '<div class="rule__n">' + r.n + '</div>' +
      '<div>' +
        '<h4 class="rule__h">' + r.head + '</h4>' +
        '<p class="rule__b">' + r.body + '</p>' +
        '<p class="rule__f">— ' + r.from + '</p>' +
      '</div>' +
    '</div>').join('');
}

/* ── 밝기 ───────────────────────────────────────────── */

function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  LS.set('theme', t);
  const m = $('meta[name=theme-color]');
  if (m) m.setAttribute('content', t === 'dark' ? '#14150F' : '#FFFDF8');
}

/* ── 시작 ───────────────────────────────────────────── */

function init() {
  setTheme(LS.get('theme', window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  const withCare = PROMPTS.filter(p => p.care).length;
  const line = '프롬프트 ' + PROMPTS.length + '편 · 서가 ' + CATS.length + '곳 · 근거 표시 ' + PROMPTS.filter(p => p.source).length + '편';
  $('#totalline').textContent = line;
  $('#foot-count').textContent = line + ' · 주의 표시 ' + withCare + '편';
  $('#stamp').textContent = '전(全) ' + PROMPTS.length + '편';

  buildRail();
  buildChips();
  buildCal();
  buildCopyright();
  buildBuilder();
  buildRules();
  paintBuilder();
  render();

  const q = $('#q');
  let qt;
  q.addEventListener('input', () => {
    $('#qx').classList.toggle('on', !!q.value);
    state.chip = null;
    clearTimeout(qt);
    qt = setTimeout(() => { state.q = q.value; render(); }, 110);
  });
  $('#qx').addEventListener('click', () => {
    q.value = ''; state.q = ''; state.chip = null;
    $('#qx').classList.remove('on'); render(); q.focus();
  });

  $('#favbtn').addEventListener('click', () => {
    state.favOnly = !state.favOnly;
    $('#favbtn').setAttribute('aria-pressed', String(state.favOnly));
    if (state.favOnly) { state.cat = 'all'; state.chip = null; state.q = ''; q.value = ''; }
    render();
  });

  $('#themebtn').addEventListener('click', () => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  $('#sheet-x').addEventListener('click', closeSheet);
  $('#scrim').addEventListener('click', closeSheet);
  $('#sheet-fav').addEventListener('click', () => { if (state.open) toggleFav(state.open); });

  $$('[data-open]').forEach(b => b.addEventListener('click', () => openModal(b.dataset.open)));
  $$('[data-close]').forEach(b => b.addEventListener('click', closeModals));
  $$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModals(); }));
  /* 모달 안의 이동 단추(월별 살림·저작권) */
  $$('.modal [data-goto]').forEach(b => b.addEventListener('click', () => { closeModals(); openSheet(b.dataset.goto); }));

  $('#bcopy').addEventListener('click', () => {
    const t = builderText();
    if (!t) { toast('먼저 칸을 채워 주십시오'); return; }
    copy(t, '지으신 프롬프트를 복사했습니다');
  });
  $('#breset').addEventListener('click', () => {
    $$('[data-b]').forEach(t => { t.value = ''; delete bvals[t.dataset.b]; });
    paintBuilder();
  });

  $('#chkrun').addEventListener('click', runCheck);
  $('#chkmask').addEventListener('click', maskText);
  $('#chkclear').addEventListener('click', () => { $('#chkin').value = ''; $('#chkout').innerHTML = ''; });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($$('.modal.on').length) closeModals();
      else if ($('#sheet').classList.contains('on')) closeSheet();
    }
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault(); q.focus();
    }
  });

  const fromHash = () => {
    const h = location.hash.replace('#', '');
    if (h && h !== state.open && byId(h)) openSheet(h);
  };
  window.addEventListener('hashchange', fromHash);
  fromHash();
}

document.addEventListener('DOMContentLoaded', init);
