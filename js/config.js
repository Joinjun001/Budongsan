// 필지맵 설정
// 브이월드 인증키는 발급할 때 등록한 서비스 URL에서만 동작합니다.
// 접속 주소(호스트)마다 키를 따로 적을 수 있습니다. 키는 브라우저에 그대로 노출되므로
// 반드시 브이월드에 서비스 URL을 등록한 키를 쓰세요.
window.PILJI_CONFIG = {
  vworldKeys: {
    // 'YOUR-GITHUB-ID.github.io': '발급받은-인증키',
    // 'localhost': '로컬-테스트용-인증키',
  },
  // API 요청의 domain 값. 비워 두면 현재 접속 주소(location.origin)를 보냅니다.
  domain: '',
  // 처음 열었을 때의 지도 중심 [위도, 경도]와 확대 단계
  start: { center: [37.5446, 127.0557], zoom: 17 }
};
