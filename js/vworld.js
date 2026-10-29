// 브이월드 오픈API 호출 모음.
// 브이월드 API는 CORS 헤더를 보내지 않으므로, 브라우저에서는 callback(JSONP) 방식으로 호출합니다.
(function () {
  'use strict';

  const cfg = window.PILJI_CONFIG || {};
  const KEY_STORE = 'pilji-vworld-key';
  const API = 'https://api.vworld.kr';

  function configuredKey() {
    const keys = cfg.vworldKeys || {};
    return keys[location.hostname] || keys['*'] || '';
  }
  function storedKey() {
    try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
  }
  const key = configuredKey() || storedKey();
  const keySource = configuredKey() ? 'config' : (key ? 'browser' : 'none');
  const domain = cfg.domain || location.origin;

  class VWorldError extends Error {
    constructor(code, message) { super(message || code); this.code = code; }
  }

  let seq = 0;
  function jsonp(path, params, timeout) {
    return new Promise((resolve, reject) => {
      const cb = '__vw' + (++seq) + '_' + Date.now().toString(36);
      const script = document.createElement('script');
      const qs = new URLSearchParams(Object.assign({}, params, { key, domain, callback: cb }));
      let settled = false;
      const finish = () => {
        settled = true;
        clearTimeout(timer);
        // 늦게 도착한 응답이 오류를 내지 않도록 빈 함수로 바꿔 둡니다.
        window[cb] = function () { delete window[cb]; };
        script.remove();
      };
      const timer = setTimeout(() => {
        if (settled) return;
        finish();
        reject(new VWorldError('TIMEOUT', '브이월드가 응답하지 않습니다.'));
      }, timeout || 9000);
      window[cb] = (data) => { if (settled) return; finish(); resolve(data); };
      script.onerror = () => {
        if (settled) return;
        finish();
        reject(new VWorldError('NETWORK', '브이월드에 요청을 보내지 못했습니다.'));
      };
      // 스크립트를 다 실행했는데 콜백이 불리지 않았다면 JSONP로 응답하지 않은 것입니다.
      // 시간 초과를 기다리지 않고 바로 실패로 처리합니다.
      script.onload = () => {
        if (settled) return;
        finish();
        reject(new VWorldError('NO_CALLBACK', '브이월드가 JSONP 형식으로 응답하지 않았습니다.'));
      };
      script.src = API + path + '?' + qs.toString();
      document.head.appendChild(script);
    });
  }

  function unwrap(data) {
    const r = data && data.response;
    if (!r) throw new VWorldError('BAD_RESPONSE', '브이월드 응답 형식을 읽지 못했습니다.');
    if (r.status === 'NOT_FOUND') return null;
    if (r.status !== 'OK') {
      const e = r.error || {};
      throw new VWorldError(e.code || 'ERROR', e.text || '브이월드 요청이 실패했습니다.');
    }
    return r.result;
  }

  // 2D 데이터 API (req/data) — 연속지적도, 용도지역 등
  async function getFeature(data, extra, timeout) {
    const res = unwrap(await jsonp('/req/data', Object.assign({
      service: 'data', version: '2.0', request: 'GetFeature', data,
      format: 'json', errorFormat: 'json', crs: 'EPSG:4326'
    }, extra), timeout));
    return res && res.featureCollection ? res.featureCollection.features : [];
  }

  // 한 지점에 있는 필지 (연속지적도 LP_PA_CBND_BUBUN)
  async function parcelAt(lng, lat) {
    const fs = await getFeature('LP_PA_CBND_BUBUN', { geomFilter: `POINT(${lng} ${lat})`, size: '1' });
    return fs[0] || null;
  }

  // PNU(필지고유번호 19자리)로 필지 찾기
  async function parcelByPnu(pnu) {
    const fs = await getFeature('LP_PA_CBND_BUBUN', { attrFilter: `pnu:=:${pnu}`, size: '1' });
    return fs[0] || null;
  }

  // 한 지점의 용도지역 (도시·관리·농림·자연환경보전지역)
  const ZONE_LAYERS = ['LT_C_UQ111', 'LT_C_UQ112', 'LT_C_UQ113', 'LT_C_UQ114'];
  async function zonesAt(lng, lat) {
    const results = await Promise.allSettled(ZONE_LAYERS.map((d) =>
      getFeature(d, { geomFilter: `POINT(${lng} ${lat})`, size: '5', geometry: 'false' }, 7000)));
    const names = [];
    let failed = 0;
    for (const r of results) {
      if (r.status !== 'fulfilled') { failed++; continue; }
      for (const f of r.value) {
        const n = f.properties && f.properties.uname;
        if (n && !names.includes(n)) names.push(n);
      }
    }
    if (failed === results.length) throw results[0].reason;
    return names;
  }

  // 토지특성정보 (국가중점데이터 API). JSONP 지원이 확인되지 않아 실패할 수 있으며,
  // 실패하면 화면은 연속지적도 값과 도형으로 계산한 면적을 대신 보여 줍니다.
  let nedUnsupported = false;
  async function landCharacteristics(pnu) {
    if (nedUnsupported) throw new VWorldError('NO_CALLBACK', '토지특성정보는 브라우저에서 받을 수 없습니다.');
    let data;
    try {
      data = await jsonp('/ned/data/getLandCharacteristics', {
        pnu, format: 'json', numOfRows: '20', pageNo: '1'
      }, 7000);
    } catch (err) {
      // JSONP를 지원하지 않으면 이후 필지에서는 요청 자체를 건너뜁니다.
      if (err.code === 'NO_CALLBACK') nedUnsupported = true;
      throw err;
    }
    const lc = data && data.landCharacteristicss;
    if (!lc) throw new VWorldError('BAD_RESPONSE', '토지특성정보 응답을 읽지 못했습니다.');
    let rows = lc.field || [];
    if (!Array.isArray(rows)) rows = [rows];
    if (!rows.length) {
      if (lc.resultCode) throw new VWorldError(lc.resultCode, lc.resultMsg);
      return null;
    }
    rows.sort((a, b) => String(b.stdrYear).localeCompare(String(a.stdrYear)));
    return rows[0];
  }

  // 주소 검색 (req/search). 지번 주소와 도로명 주소를 동시에 찾고, 둘 다 없으면 장소를 찾습니다.
  const searchCache = new Map();
  async function searchOne(query, t) {
    const res = unwrap(await jsonp('/req/search', Object.assign({
      service: 'search', request: 'search', version: '2.0', crs: 'EPSG:4326',
      size: '8', page: '1', query, format: 'json', errorFormat: 'json'
    }, t), 8000));
    const items = res && res.items ? res.items : [];
    return items.map((it) => ({
      kind: t.type === 'place' ? 'place' : t.category,
      title: t.type === 'place' ? it.title : (t.category === 'parcel' ? it.address.parcel : it.address.road),
      sub: t.type === 'place' ? (it.address && (it.address.road || it.address.parcel)) : (t.category === 'parcel' ? it.address.road : it.address.parcel),
      lng: Number(it.point.x), lat: Number(it.point.y)
    }));
  }
  async function search(query) {
    if (searchCache.has(query)) return searchCache.get(query);
    const [parcel, road] = await Promise.allSettled([
      searchOne(query, { type: 'address', category: 'parcel' }),
      searchOne(query, { type: 'address', category: 'road' })
    ]);
    let found = [];
    if (parcel.status === 'fulfilled' && parcel.value.length) found = parcel.value;
    else if (road.status === 'fulfilled' && road.value.length) found = road.value;
    else if (parcel.status === 'rejected' && road.status === 'rejected') throw parcel.reason;
    else found = await searchOne(query, { type: 'place' });
    searchCache.set(query, found);
    return found;
  }

  function wmtsUrl(layer, ext) {
    return `${API}/req/wmts/1.0.0/${key}/${layer}/{z}/{y}/{x}.${ext}`;
  }
  const wmsUrl = API + '/req/wms';

  function saveKey(k) {
    try { localStorage.setItem(KEY_STORE, k.trim()); return true; } catch (e) { return false; }
  }
  function forgetKey() {
    try { localStorage.removeItem(KEY_STORE); } catch (e) { /* 저장소를 쓸 수 없는 브라우저 */ }
  }

  window.VWorld = {
    key, keySource, domain, hasKey: !!key, VWorldError,
    parcelAt, parcelByPnu, zonesAt, landCharacteristics, search,
    wmtsUrl, wmsUrl, saveKey, forgetKey
  };
})();
