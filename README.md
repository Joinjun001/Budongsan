# 필지맵

브이월드(국토교통부 공간정보 오픈플랫폼) 연속지적도를 지도 위에 겹쳐 보여 주고, 필지를 누르면 토지정보를 보여 주는 웹서비스입니다. 빌드 과정이 없는 정적 사이트라서 GitHub Pages에 그대로 올려 쓸 수 있습니다.

## 기능

- 브이월드 배경지도: 일반, 백지도, 야간, 위성(지명 포함)
- 연속지적도와 용도지역 겹쳐 보기 (WMS)
- 필지를 누르면 경계를 강조하고 지번, 지목, 면적, 용도지역, 개별공시지가, 공시지가 총액을 보여 줌
- 토지특성정보(이용상황, 도로접면, 지형)도 불러오려고 시도함. 받지 못하면 그 항목만 비워 둠
- 여러 필지 선택: 면적과 공시지가를 합산
- 지번·도로명 주소 검색
- 필지 링크 공유: 주소 끝에 `#필지고유번호(PNU)`가 붙음
- PC와 모바일 반응형 화면, 라이트·다크 모드

## 1. 브이월드 인증키 발급

1. [vworld.kr](https://www.vworld.kr)에 가입하고 로그인합니다.
2. 오픈API 메뉴에서 인증키를 발급받습니다. 활용 API에서 2D 지도 API, 2D 데이터 API, 검색 API, WMS/WFS API를 고릅니다. 토지특성정보까지 쓰려면 국가중점데이터(토지특성정보)도 함께 신청합니다.
3. 서비스 URL에는 이 사이트를 열 주소를 적습니다.
   - GitHub Pages: `https://<깃허브아이디>.github.io`
   - 내 컴퓨터에서 시험할 때: `http://localhost:8000`

인증키는 등록한 서비스 URL에서만 동작합니다. 배포 주소와 로컬 주소에 각각 키를 쓰려면 키를 두 개 발급받으세요.

## 2. 인증키 넣기

`js/config.js`의 `vworldKeys`에 접속 주소(호스트)별로 키를 적습니다.

```js
vworldKeys: {
  'myid.github.io': '발급받은-배포용-인증키',
  'localhost': '발급받은-로컬용-인증키',
},
```

키를 파일에 적지 않으면 첫 화면 오른쪽 패널에서 키를 붙여 넣을 수 있습니다. 이렇게 넣은 키는 그 브라우저에만 저장됩니다.

브이월드 인증키는 브라우저에서 호출하는 방식이라 사이트를 여는 누구나 키를 볼 수 있습니다. 브이월드는 서비스 URL로 사용처를 제한하므로, 반드시 서비스 URL을 정확히 등록한 키를 쓰세요.

## 3. 내 컴퓨터에서 실행

```bash
python3 -m http.server 8000
```

브라우저에서 `http://localhost:8000`을 엽니다. 파일을 더블클릭해서 `file://`로 열면 인증키 도메인 확인을 통과하지 못합니다.

## 4. GitHub Pages로 배포

1. GitHub에서 새 저장소를 만들고 이 폴더를 올립니다.

   ```bash
   git init
   git add .
   git commit -m "필지맵 첫 배포"
   git branch -M main
   git remote add origin https://github.com/<깃허브아이디>/<저장소이름>.git
   git push -u origin main
   ```

2. 저장소의 **Settings → Pages**에서 Source를 **Deploy from a branch**, Branch를 **main / (root)**로 정하고 저장합니다.
3. 1~2분 뒤 `https://<깃허브아이디>.github.io/<저장소이름>/`에서 열립니다.
4. 브이월드 인증키의 서비스 URL이 `https://<깃허브아이디>.github.io`인지 다시 확인합니다.

`.nojekyll` 파일은 GitHub Pages가 Jekyll 변환 없이 파일을 그대로 내보내게 합니다.

## 파일 구성

| 파일 | 내용 |
|---|---|
| `index.html` | 화면 구조 |
| `css/style.css` | 화면 스타일 (라이트·다크 색상 토큰) |
| `js/config.js` | 인증키, 시작 위치 설정 |
| `js/vworld.js` | 브이월드 API 호출 (JSONP) |
| `js/app.js` | 지도, 필지 선택, 정보 패널, 검색 |

## 사용하는 브이월드 API

| 용도 | API |
|---|---|
| 배경지도 | WMTS `req/wmts` (Base, white, midnight, Satellite, Hybrid) |
| 지적도·용도지역 그림 | WMS `req/wms` (`lp_pa_cbnd_bubun`, `lp_pa_cbnd_bonbun`, `lt_c_uq111`~`lt_c_uq114`) |
| 필지 경계·지번·공시지가 | 2D 데이터 API `req/data` (`LP_PA_CBND_BUBUN`) |
| 용도지역 이름 | 2D 데이터 API `req/data` (`LT_C_UQ111`~`LT_C_UQ114`) |
| 토지특성정보 | 국가중점데이터 `ned/data/getLandCharacteristics` |
| 주소 검색 | 검색 API `req/search` |

브이월드 API는 CORS 헤더를 보내지 않아서 브라우저의 `fetch`로는 읽을 수 없습니다. 그래서 `callback` 파라미터(JSONP)를 지원하는 API만 브라우저에서 바로 호출합니다. 토지특성정보 API가 JSONP로 응답하지 않으면 면적은 필지 도형으로 계산한 값을 보여 주고, 이용상황·도로접면·지형은 표시하지 않습니다. 이 정보가 꼭 필요하면 서버(예: Cloudflare Workers, Vercel 함수)를 하나 두고 대신 호출하게 바꾸면 됩니다.

## 주의

연속지적도는 참고용 도면이라 법적 효력이 없습니다. 정확한 면적과 경계는 토지대장과 지적도 등본으로 확인하세요.
