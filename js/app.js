(() => {
'use strict';

const V = window.VWorld;
const cfg = window.PILJI_CONFIG || {};
const $ = (s) => document.querySelector(s);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// 지목 부호 → 지목명 (공간정보관리법 28개 지목)
const JIMOK = {
  전:'전', 답:'답', 과:'과수원', 목:'목장용지', 임:'임야', 광:'광천지', 염:'염전', 대:'대지',
  장:'공장용지', 학:'학교용지', 차:'주차장', 주:'주유소용지', 창:'창고용지', 도:'도로', 철:'철도용지',
  제:'제방', 천:'하천', 구:'구거', 유:'유지', 양:'양어장', 수:'수도용지', 공:'공원', 체:'체육용지',
  원:'유원지', 종:'종교용지', 사:'사적지', 묘:'묘지', 잡:'잡종지'
};

/* ───────── 표기 도우미 ───────── */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: d });
const pyeong = (a) => (a * 0.3025).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function won(n) {
  const eok = Math.floor(n / 1e8), man = Math.round((n - eok * 1e8) / 1e4);
  if (eok && man) return `${fmt(eok)}억 ${fmt(man)}만 원`;
  if (eok) return `${fmt(eok)}억 원`;
  if (man) return `${fmt(man)}만 원`;
  return `${fmt(n)} 원`;
}
function parseJibun(j) {
  const m = String(j || '').trim().match(/^(산\s*)?([\d]+(?:-[\d]+)?)\s*(.*)$/);
  if (!m) return { num: String(j || ''), jimok: '' };
  return { num: (m[1] ? '산 ' : '') + m[2], jimok: m[3].trim() };
}
function zoneColor(n) {
  if (/상업/.test(n)) return '#F2958C';
  if (/공업/.test(n)) return '#C9A7E8';
  if (/준주거/.test(n)) return '#F6AF66';
  if (/전용|제1종/.test(n)) return '#FFF2AE';
  if (/주거/.test(n)) return '#FFDF74';
  if (/녹지/.test(n)) return '#B7E1A4';
  if (/관리/.test(n)) return '#D6E8B0';
  if (/농림/.test(n)) return '#E3D8A2';
  if (/보전/.test(n)) return '#9FD4C8';
  return '#D2D9D7';
}
// 경위도 다각형의 면적(㎡). 구면 근사식이라 필지 크기에서는 오차가 매우 작습니다.
function ringArea(ring) {
  const R = 6378137, d = Math.PI / 180;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    a += (x2 - x1) * d * (2 + Math.sin(y1 * d) + Math.sin(y2 * d));
  }
  return Math.abs(a * R * R / 2);
}
function geomArea(g) {
  if (!g) return 0;
  const poly = (rings) => rings.reduce((s, r, i) => s + (i ? -1 : 1) * ringArea(r), 0);
  if (g.type === 'Polygon') return poly(g.coordinates);
  if (g.type === 'MultiPolygon') return g.coordinates.reduce((s, p) => s + poly(p), 0);
  return 0;
}

/* ───────── 알림 ───────── */
const noticeEl = $('#notice'), noticeText = $('#noticeText'), noticeAct = $('#noticeAct');
let noticeKind = '', noticeTimer = 0, noticeFn = null;
function notify(text, opts = {}) {
  const kind = opts.kind || 'warn';
  if (kind === 'hint' && noticeKind === 'warn' && !noticeEl.hidden) return;
  clearTimeout(noticeTimer);
  noticeKind = kind;
  noticeEl.className = 'notice' + (kind === 'warn' ? '' : ' info');
  noticeText.textContent = text;
  noticeFn = opts.action ? opts.action.fn : null;
  noticeAct.hidden = !opts.action;
  if (opts.action) noticeAct.textContent = opts.action.label;
  noticeEl.hidden = false;
  if (opts.timeout) noticeTimer = setTimeout(hideNotice, opts.timeout);
}
function hideNotice(kind) {
  if (kind && kind !== noticeKind) return;
  noticeEl.hidden = true; noticeKind = '';
}
noticeAct.addEventListener('click', () => { const fn = noticeFn; hideNotice(); if (fn) fn(); });
$('#noticeX').addEventListener('click', () => hideNotice());

function explain(err) {
  const code = err && err.code;
  if (code === 'INVALID_KEY') return V.keySource === 'browser'
    ? '등록되지 않은 브이월드 인증키입니다. 오른쪽 패널에서 저장한 키를 지우고 다시 넣어 주세요.'
    : '등록되지 않은 브이월드 인증키입니다. js/config.js에 적은 키를 확인하세요.';
  if (code === 'INCORRECT_KEY' || code === 'INVALID_DOMAIN') return `인증키와 접속 주소가 맞지 않습니다. 브이월드에 등록한 서비스 URL이 ${V.domain} 인지 확인하세요.`;
  if (code === 'OVER_REQUEST_LIMIT') return '오늘 쓸 수 있는 브이월드 요청 수를 넘었습니다. 내일 다시 시도하세요.';
  return (err && err.message) || '브이월드 요청이 실패했습니다.';
}

/* ───────── 지도 ───────── */
let saved = null;
try { saved = JSON.parse(localStorage.getItem('pilji-view') || 'null'); } catch (e) { saved = null; }
const start = cfg.start || { center: [37.5446, 127.0557], zoom: 17 };
const map = L.map('map', {
  zoomControl: false, attributionControl: false, minZoom: 7, maxZoom: 20,
  center: saved ? saved.c : start.center, zoom: saved ? saved.z : start.zoom
});
L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);
map.createPane('zonePane').style.zIndex = 405;
map.createPane('cadPane').style.zIndex = 410;
map.createPane('pickPane').style.zIndex = 450;

const ATTR = '© <a href="https://www.vworld.kr" target="_blank" rel="noopener">VWorld</a>';
let tileErrors = 0;
function watchTiles(layer) {
  layer.on('tileerror', () => {
    tileErrors++;
    if (tileErrors === 6) notify('지도 그림을 불러오지 못하고 있습니다. 브이월드 인증키와 등록한 서비스 URL을 확인하세요.');
  });
  return layer;
}
const NATIVE = { Base: 19, Satellite: 19, Hybrid: 19, white: 18, midnight: 18 };
// 확대·축소 애니메이션 중에는 중간 단계 타일을 받지 않고, 화면 밖 타일을 넉넉히 남겨 둡니다.
const TILE_OPTS = { updateWhenZooming: false, keepBuffer: 4 };
function makeBase(name) {
  const tile = (n, ext) => watchTiles(L.tileLayer(V.wmtsUrl(n, ext), Object.assign({ maxNativeZoom: NATIVE[n], maxZoom: 20, minZoom: 6, attribution: ATTR }, TILE_OPTS)));
  if (name === 'Satellite') return L.layerGroup([tile('Satellite', 'jpeg'), tile('Hybrid', 'png')]);
  return tile(name, 'png');
}
let baseName = 'Base', baseLayer = null;
try { const b = localStorage.getItem('pilji-base'); if (NATIVE[b] && b !== 'Hybrid') baseName = b; } catch (e) { /* 기본값 사용 */ }
function setBase(name) {
  if (baseLayer) map.removeLayer(baseLayer);
  baseName = name;
  baseLayer = makeBase(name).addTo(map);
  document.querySelectorAll('[data-base]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.base === name)));
  try { localStorage.setItem('pilji-base', name); } catch (e) { /* 저장 생략 */ }
}

// WMS는 서버가 그림을 매번 새로 그리므로 느립니다. 512px 타일로 요청 수를 1/4로 줄이고,
// 지도가 멈춘 뒤에만 요청합니다.
function wms(layers, opts) {
  return watchTiles(L.tileLayer.wms(V.wmsUrl, Object.assign({
    layers, styles: layers, format: 'image/png', transparent: 'TRUE', version: '1.3.0',
    tileSize: 512, updateWhenIdle: true,
    maxZoom: 20, key: V.key, domain: V.domain, attribution: ATTR
  }, TILE_OPTS, opts)));
}
const CAD_MIN_ZOOM = 15;
const cadLayer = V.hasKey ? wms('lp_pa_cbnd_bubun,lp_pa_cbnd_bonbun', { pane: 'cadPane', minZoom: CAD_MIN_ZOOM }) : null;
const zoneLayer = V.hasKey ? wms('lt_c_uq111,lt_c_uq112,lt_c_uq113,lt_c_uq114', { pane: 'zonePane', minZoom: 11, opacity: 0.5 }) : null;

if (V.hasKey) {
  setBase(baseName);
  cadLayer.addTo(map);
} else {
  // 인증키가 없을 때는 OpenStreetMap 배경만 보여 줍니다.
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20, maxNativeZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  }).addTo(map);
  document.querySelectorAll('[data-base], #tCad, #tZone').forEach((b) => { b.disabled = true; b.setAttribute('aria-pressed', 'false'); });
  $('#sourceChip').innerHTML = '<b>인증키 필요</b> 배경지도만 표시 중';
}

// 멀리 갈 때 flyTo는 여러 확대 단계를 거치며 타일을 잔뜩 받아 버벅입니다.
// 지금 화면 근처면 짧게 날아가고, 멀면 바로 옮깁니다.
function moveTo(latlng, zoom) {
  const near = map.getBounds().pad(1.5).contains(latlng) && Math.abs(map.getZoom() - zoom) <= 3;
  if (near && !reduceMotion) map.flyTo(latlng, zoom, { duration: 0.6 });
  else map.setView(latlng, zoom, { animate: false });
}
function moveToBounds(bounds) {
  const z = Math.min(map.getBoundsZoom(bounds, false, L.point(120, 120)), 19);
  moveTo(bounds.getCenter(), z);
}

map.on('moveend', () => {
  const c = map.getCenter();
  try { localStorage.setItem('pilji-view', JSON.stringify({ c: [c.lat, c.lng], z: map.getZoom() })); } catch (e) { /* 저장 생략 */ }
  zoomHint();
});
function zoomHint() {
  if (!cadLayer || !map.hasLayer(cadLayer)) { hideNotice('hint'); return; }
  if (map.getZoom() < CAD_MIN_ZOOM) {
    notify('지적도는 더 확대해야 보입니다.', { kind: 'hint', action: { label: '확대하기', fn: () => map.setZoom(17) } });
  } else hideNotice('hint');
}

/* ───────── 툴바 ───────── */
document.querySelectorAll('[data-base]').forEach((b) => b.addEventListener('click', () => { if (V.hasKey) setBase(b.dataset.base); }));
function bindToggle(btn, layer) {
  btn.addEventListener('click', () => {
    if (!layer) return;
    const on = !map.hasLayer(layer);
    if (on) layer.addTo(map); else map.removeLayer(layer);
    btn.setAttribute('aria-pressed', String(on));
    zoomHint();
  });
}
bindToggle($('#tCad'), cadLayer);
bindToggle($('#tZone'), zoneLayer);
let multi = false;
$('#tMulti').addEventListener('click', (e) => {
  multi = !multi;
  e.currentTarget.setAttribute('aria-pressed', String(multi));
  if (!multi && sel.size > 1) {
    const keep = [...sel.keys()].pop();
    for (const k of [...sel.keys()]) if (k !== keep) removeSel(k);
  }
  render();
});
$('#zin').addEventListener('click', () => map.zoomIn());
$('#zout').addEventListener('click', () => map.zoomOut());
$('#locate').addEventListener('click', () => {
  if (!navigator.geolocation) { notify('이 브라우저는 위치 찾기를 지원하지 않습니다.'); return; }
  navigator.geolocation.getCurrentPosition(
    (p) => moveTo(L.latLng(p.coords.latitude, p.coords.longitude), 18),
    () => notify('내 위치를 가져오지 못했습니다. 브라우저의 위치 권한을 확인하세요.', { timeout: 5000 }),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

/* ───────── 필지 선택 ───────── */
const sel = new Map(); // pnu → 선택 정보
let pickSeq = 0;
const busyEl = $('#busy');
function accentStyle() {
  const cs = getComputedStyle(document.documentElement);
  const a = cs.getPropertyValue('--accent').trim();
  return { color: a, weight: 2.5, opacity: 1, fillColor: a, fillOpacity: 0.18 };
}

map.on('click', (e) => {
  if (!V.hasKey) { notify('필지를 고르려면 먼저 브이월드 인증키를 넣어 주세요.', { timeout: 4000 }); return; }
  const additive = multi || e.originalEvent.shiftKey || e.originalEvent.metaKey || e.originalEvent.ctrlKey;
  // 지도 이동과 필지 조회를 동시에 시작해 기다리는 시간을 줄입니다.
  if (map.getZoom() < 15) moveTo(e.latlng, 17);
  pickAt(e.latlng, additive);
});

async function pickAt(latlng, additive) {
  const token = ++pickSeq;
  busyEl.hidden = false;
  try {
    const f = await V.parcelAt(latlng.lng, latlng.lat);
    if (token !== pickSeq) return;
    if (!f) { notify('이 위치에는 필지 정보가 없습니다.', { kind: 'info', timeout: 3000 }); return; }
    select(f, additive, latlng);
  } catch (err) {
    if (token === pickSeq) notify(explain(err));
  } finally {
    if (token === pickSeq) busyEl.hidden = true;
  }
}

function removeSel(pnu) {
  const it = sel.get(pnu);
  if (it) { map.removeLayer(it.layer); sel.delete(pnu); }
}
function clearSel() { for (const k of [...sel.keys()]) removeSel(k); }

function select(f, additive, latlng) {
  const p = f.properties || {};
  const pnu = p.pnu;
  if (sel.has(pnu) && (additive || sel.size === 1)) { removeSel(pnu); afterChange(); return; }
  if (!additive) clearSel();
  if (sel.has(pnu)) { afterChange(); return; }
  const layer = L.geoJSON(f, { pane: 'pickPane', style: accentStyle, interactive: false }).addTo(map);
  const pt = latlng || layer.getBounds().getCenter();
  const item = {
    pnu, props: p, layer, jb: parseJibun(p.jibun), area: geomArea(f.geometry),
    zones: null, zoneState: 'loading', land: null, landState: 'loading'
  };
  sel.set(pnu, item);
  afterChange();
  V.zonesAt(pt.lng, pt.lat).then(
    (z) => { item.zones = z; item.zoneState = 'ok'; },
    () => { item.zoneState = 'error'; }
  ).then(() => { if (sel.get(pnu) === item) render(); });
  V.landCharacteristics(pnu).then(
    (l) => { item.land = l; item.landState = l ? 'ok' : 'none'; },
    () => { item.landState = 'error'; }
  ).then(() => { if (sel.get(pnu) === item) render(); });
}
function afterChange() {
  render();
  try {
    if (sel.size === 1) history.replaceState(null, '', '#' + [...sel.keys()][0]);
    else history.replaceState(null, '', location.pathname + location.search);
  } catch (e) { /* 주소 갱신 생략 */ }
}
function focusItem(it) {
  moveToBounds(it.layer.getBounds());
}

/* ───────── 정보 패널 ───────── */
const selEl = $('#sel');
const pending = (t) => `<span class="pending">${t}</span>`;
function titleOf(it) {
  const parts = String(it.props.addr || '').trim().split(/\s+/);
  const place = parts.length >= 2 ? parts[parts.length - 2] : '';
  return `${place} ${it.jb.num}`.trim();
}
function areaOf(it) {
  const a = it.land && Number(it.land.lndpclAr);
  return a > 0 ? { v: a, official: true } : { v: it.area, official: false };
}

function detailHTML(it) {
  const p = it.props, land = it.land, area = areaOf(it);
  const jimokName = (land && land.lndcgrCodeNm) || JIMOK[it.jb.jimok] || it.jb.jimok || '—';
  const jiga = Number(p.jiga);
  const rows = [];
  rows.push(['지목', `${esc(jimokName)}${it.jb.jimok ? ` <span class="muted">(${esc(it.jb.jimok)})</span>` : ''}`]);
  rows.push(['면적', area.official
    ? `${fmt(area.v, 1)} ㎡ <span class="muted">· ${pyeong(area.v)}평</span><span class="src">토지특성</span>`
    : `약 ${fmt(area.v)} ㎡ <span class="muted">· ${pyeong(area.v)}평</span><span class="src">도형 계산</span>`]);

  let zone;
  if (it.zoneState === 'loading') zone = pending('확인 중…');
  else if (it.zones && it.zones.length) zone = it.zones.map((n) => `<span><i class="dot" style="background:${zoneColor(n)}"></i>${esc(n)}</span>`).join('<br>');
  else if (land && land.prposArea1Nm) zone = `<i class="dot" style="background:${zoneColor(land.prposArea1Nm)}"></i>${esc(land.prposArea1Nm)}`;
  else zone = it.zoneState === 'error' ? pending('불러오지 못했습니다') : pending('지정 정보 없음');
  rows.push(['용도지역', zone]);

  if (it.landState === 'loading') rows.push(['토지특성', pending('불러오는 중…')]);
  else if (it.landState === 'ok') {
    if (land.ladUseSittnNm) rows.push(['이용상황', esc(land.ladUseSittnNm)]);
    if (land.roadSideCodeNm) rows.push(['도로접면', esc(land.roadSideCodeNm)]);
    const terrain = [land.tpgrphHgCodeNm, land.tpgrphFrmCodeNm].filter(Boolean).join(' · ');
    if (terrain) rows.push(['지형', esc(terrain)]);
    if (land.stdrYear) rows.push(['기준년도', `${esc(land.stdrYear)}년 <span class="muted">토지특성 조사</span>`]);
  } else rows.push(['토지특성', pending('브이월드에서 받지 못했습니다')]);

  const fig = jiga > 0
    ? `<div class="figure"><span class="eyebrow">개별공시지가 · ${esc(p.gosi_year)}년 ${Number(p.gosi_month) || 1}월 기준</span>
        <strong>${fmt(jiga)}<small>원/㎡</small></strong>
        <span class="sub">필지 전체 <b>${area.official ? '' : '약 '}${won(jiga * area.v)}</b> · 평당 ${won(jiga / 0.3025)}</span></div>`
    : `<div class="figure"><span class="eyebrow">개별공시지가</span><strong style="font-size:18px">공시지가 정보 없음</strong>
        <span class="sub">도로·하천 등은 공시지가가 없을 수 있습니다</span></div>`;

  return `<div class="addr"><span class="eyebrow">선택한 필지</span>
      <h2>${esc(titleOf(it))}${it.jb.jimok ? `<span class="jm" title="지목 부호">${esc(it.jb.jimok)}</span>` : ''}</h2>
      <span class="full">${esc(p.addr)}</span>
      <span class="pnu">PNU <code>${esc(it.pnu)}</code><button class="linkbtn" type="button" data-act="copy-pnu">복사</button></span></div>
    ${fig}
    <dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    <div class="actions">
      <button class="btn primary" type="button" data-act="focus">이 필지로 이동</button>
      <button class="btn" type="button" data-act="copy-link">링크 복사</button>
      <button class="btn" type="button" data-act="clear">선택 해제</button>
    </div>`;
}

function multiHTML() {
  const items = [...sel.values()];
  let area = 0, total = 0, approx = false;
  for (const it of items) {
    const a = areaOf(it); area += a.v; if (!a.official) approx = true;
    const j = Number(it.props.jiga); if (j > 0) total += j * a.v;
  }
  return `<div class="addr"><span class="eyebrow">여러 필지 선택</span><h2>${items.length}개 필지</h2></div>
    <div class="sum">
      <div class="figure"><span class="eyebrow">면적 합계</span><strong>${approx ? '약 ' : ''}${fmt(area)}<small>㎡</small></strong><span class="sub">${pyeong(area)}평</span></div>
      <div class="figure"><span class="eyebrow">공시지가 합계</span><strong>${total ? won(total).replace(/ 원$/, '') : '–'}<small>${total ? '원' : ''}</small></strong><span class="sub">면적 × 개별공시지가</span></div>
    </div>
    <ul class="picked">${items.map((it) => `<li>
      <button class="go" type="button" data-go="${esc(it.pnu)}">${esc(titleOf(it))}<span>${esc(JIMOK[it.jb.jimok] || it.jb.jimok)}</span></button>
      <span class="a">${fmt(areaOf(it).v)}㎡</span>
      <button class="rm" type="button" data-rm="${esc(it.pnu)}" aria-label="${esc(titleOf(it))} 선택 빼기">×</button></li>`).join('')}</ul>
    <div class="actions"><button class="btn" type="button" data-act="clear">모두 해제</button></div>`;
}

function emptyHTML() {
  return `<div class="empty"><span class="eyebrow">필지 정보</span><h2>지도에서 필지를 누르세요</h2>
    <p>지번, 지목, 면적, 용도지역, 개별공시지가를 브이월드에서 불러와 이곳에 보여 줍니다.</p>
    <ol><li>위 검색창에 지번이나 도로명 주소를 넣으면 그 위치로 이동합니다.</li>
      <li>‘여러 필지 선택’을 켜면 누르는 필지가 계속 추가되고 면적과 공시지가를 합산합니다.</li>
      <li>필지 하나를 고르면 주소창 링크에 필지고유번호가 붙어 그대로 공유할 수 있습니다.</li></ol>
    ${V.keySource === 'browser' ? '<div class="actions"><button class="btn" type="button" data-act="forget-key">이 브라우저에 저장한 인증키 지우기</button></div>' : ''}</div>`;
}

function setupHTML() {
  return `<div class="empty"><span class="eyebrow">처음 설정</span><h2>브이월드 인증키를 넣어 주세요</h2>
    <p>지적도와 토지정보는 브이월드 오픈API로 불러옵니다. 인증키가 없으면 배경지도만 보입니다.</p>
    <ol><li><a href="https://www.vworld.kr" target="_blank" rel="noopener">vworld.kr</a>에 가입한 뒤 오픈API 메뉴에서 인증키를 발급받습니다.</li>
      <li>서비스 URL에 지금 주소 <code>${esc(V.domain)}</code> 를 등록합니다.</li>
      <li>받은 키를 아래에 붙여 넣습니다. 배포할 때는 js/config.js에 적어 두세요.</li></ol>
    <form class="keyform" id="keyForm"><input id="keyInput" type="text" autocomplete="off" spellcheck="false" placeholder="인증키 붙여 넣기" aria-label="브이월드 인증키">
      <button class="btn primary" type="submit">저장하고 다시 열기</button></form>
    <p class="muted" style="font-size:12px;margin:0">여기에 넣은 키는 이 브라우저에만 저장됩니다.</p></div>`;
}

function render() {
  if (!V.hasKey) selEl.innerHTML = setupHTML();
  else if (!sel.size) selEl.innerHTML = emptyHTML();
  else if (sel.size === 1) selEl.innerHTML = detailHTML([...sel.values()][0]);
  else selEl.innerHTML = multiHTML();
}

function copyText(text, btn) {
  const label = btn.textContent;
  const done = () => { btn.textContent = '복사됨'; setTimeout(() => { btn.textContent = label; }, 1400); };
  const fail = () => notify('복사하지 못했습니다. 직접 선택해서 복사하세요.', { kind: 'info', timeout: 3000 });
  try { navigator.clipboard.writeText(text).then(done, fail); } catch (e) { fail(); }
}

$('#sheet').addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.go) { const it = sel.get(t.dataset.go); if (it) focusItem(it); return; }
  if (t.dataset.rm) { removeSel(t.dataset.rm); afterChange(); return; }
  const it = [...sel.values()][0];
  switch (t.dataset.act) {
    case 'clear': clearSel(); afterChange(); break;
    case 'focus': if (it) focusItem(it); break;
    case 'copy-pnu': if (it) copyText(it.pnu, t); break;
    case 'copy-link': if (it) copyText(location.origin + location.pathname + '#' + it.pnu, t); break;
    case 'forget-key': V.forgetKey(); location.reload(); break;
  }
});
$('#sheet').addEventListener('submit', (e) => {
  if (e.target.id !== 'keyForm') return;
  e.preventDefault();
  const k = $('#keyInput').value.trim();
  if (!k) { $('#keyInput').focus(); return; }
  if (V.saveKey(k)) location.reload();
  else notify('이 브라우저에는 키를 저장할 수 없습니다. js/config.js에 적어 주세요.');
});

/* ───────── 주소 검색 ───────── */
const qEl = $('#q'), resEl = $('#results');
let results = [], active = 0, searchTimer = 0, searchSeq = 0;
function renderResults(state) {
  if (state === 'loading') resEl.innerHTML = '<li class="empty">찾는 중…</li>';
  else if (!results.length) resEl.innerHTML = `<li class="empty">‘${esc(qEl.value.trim())}’에 맞는 주소가 없습니다. 동 이름과 번지를 함께 넣어 보세요 (예: 성수동2가 273).</li>`;
  else resEl.innerHTML = results.map((r, i) => `<li><button type="button" role="option" aria-selected="${i === active}" data-i="${i}">
      <span class="r-main">${esc(r.title)}</span>${r.sub ? `<span class="r-sub">${esc(r.sub)}</span>` : ''}</button></li>`).join('');
  resEl.hidden = false;
}
async function runSearch() {
  const q = qEl.value.trim();
  if (q.length < 2) { resEl.hidden = true; return; }
  if (!V.hasKey) { resEl.innerHTML = '<li class="empty">주소 검색은 브이월드 인증키를 넣은 뒤에 쓸 수 있습니다.</li>'; resEl.hidden = false; return; }
  const token = ++searchSeq;
  renderResults('loading');
  try {
    const r = await V.search(q);
    if (token !== searchSeq) return;
    results = r; active = 0; renderResults();
  } catch (err) {
    if (token !== searchSeq) return;
    results = [];
    resEl.innerHTML = `<li class="empty">${esc(explain(err))}</li>`;
  }
}
function choose(r) {
  resEl.hidden = true;
  qEl.value = r.title;
  qEl.blur();
  const ll = L.latLng(r.lat, r.lng);
  moveTo(ll, 18);
  pickAt(ll, multi);
}
qEl.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 350); });
qEl.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' && results.length) { e.preventDefault(); active = (active + 1) % results.length; renderResults(); }
  else if (e.key === 'ArrowUp' && results.length) { e.preventDefault(); active = (active - 1 + results.length) % results.length; renderResults(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (!resEl.hidden && results[active]) choose(results[active]);
    else { clearTimeout(searchTimer); runSearch(); }
  } else if (e.key === 'Escape') resEl.hidden = true;
});
qEl.addEventListener('focus', () => { if (results.length && qEl.value.trim()) renderResults(); });
qEl.addEventListener('blur', () => setTimeout(() => { resEl.hidden = true; }, 150));
resEl.addEventListener('mousedown', (e) => e.preventDefault());
resEl.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) choose(results[+b.dataset.i]); });

/* ───────── 시작 ───────── */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.activeElement !== qEl && sel.size) { clearSel(); afterChange(); }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  for (const it of sel.values()) it.layer.setStyle(accentStyle());
});

render();
zoomHint();

// 주소 끝에 #필지고유번호(19자리)가 있으면 그 필지를 열어 줍니다.
const hashPnu = (location.hash || '').slice(1);
if (V.hasKey && /^\d{19}$/.test(hashPnu)) {
  busyEl.hidden = false;
  V.parcelByPnu(hashPnu).then((f) => {
    if (!f) { notify('링크의 필지를 찾지 못했습니다.', { kind: 'info', timeout: 4000 }); return; }
    select(f, false, null);
    const it = sel.get(hashPnu);
    if (it) map.fitBounds(it.layer.getBounds(), { padding: [60, 60], maxZoom: 19 });
  }, (err) => notify(explain(err))).finally(() => { busyEl.hidden = true; });
}
})();
