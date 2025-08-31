import { useAuthStore } from "@/stores/auth";
import axios from "axios";  // axios 라이브러리를 사용해 HTTP 통신 구현

// 커스텀한 axios 인스턴스
const apiClient = axios.create({
    // API 요청 기본 URL 설정
    baseURL: 'http://localhost:8080',
    timeout: 10000   // 10초를 넘기면 타임아웃 발생 
});


// 요청(request) 인터셉터 -> HTTP 요청이 서버로 전송되기 전에 실행된다.
// 여기서는 요청 전에 헤더에 토큰을 추가하는 방식
apiClient.interceptors.request.use(
    // HTTP 요청을 서버로 보내기 전에 config 객체를 수정함
    // Authorization 헤더에 accessToken을 추가하는 로직이 포함되어 있음
    (config) => {
        if (config._skipInterceptor) {
            // 만약 요청 객체에 _skipInterceptor가 설정되어 있으면 인터셉터 건너뜀
            return config;
        }

        // 로컬 스토리지에서 accessToken을 가져온다.
        const accessToken = localStorage.getItem('accessToken');

        // accessToken 확인 후 Authorization 해더에 accessToken을 추가한다.
        if (accessToken) {
            config.headers['Authorization'] = `Bearer ${accessToken}`;
        }

        return config;
    },

    (error) => {
        // 비동기 코드에서 에러를 처리하거나 에러를 즉시 반환할 때 사용한다.
        return Promise.reject(error);
    }
);

// 서버에서 도착한 HTTP 응답(response) 인터셉터
apiClient.interceptors.response.use(
    (response) => {
        // 평범한 response가 온 경우, 그냥 response 그대로 반환
        return response;
    },
    // 비동기 함수
    async (error) => {

        // 이전 요청에 대한 config 객체
        const originalRequest = error.config;
        console.log(error);

        if (
            originalRequest.url === '/bonbon/user/refresh' // 이미 재시도 한 요청
          ) {
            const authStore = useAuthStore();
            authStore.logout();
            console.log("refreshToken도 만료 → 바로 로그아웃");
            return;
          }

        // 토큰이 만료되어 401 에러가 발생한 경우, retry 한 적이 없는 경우
        if (error.response.status === 401 && !originalRequest._retry) {

            // 무한 요청 재시도를 방지하기 위한 체크 변수
            originalRequest._retry = true;  // 객체에서 동적으로 추가된 변수 -> 응답 인터셉터 내에서 직접 추가됨
            try {
                // localStorage에서 refreshToken을 가져옴
                const refreshToken = localStorage.getItem('refreshToken');

                // refreshToken이 존재하지 않는 경우~~~~ -> 무한 루프 방지ㅎㅎ
                if (!refreshToken) {
                    // const authStore = useAuthStore();
                    // authStore.logout();
                    return Promise.reject(error);  // 리프레시 토큰이 없으면 바로 에러 반환
                }

                // 이 토큰을 Authorization 헤더에 Bearer ${refresh} 형태로 담아서 해당 엔드포인트에 POST 요청 전송
                // apiClient.post -> axios의 POST 메서드 호출 코드
                 
                // await : Promise가 해결될 때까지 기다리고, 값을 반환
                //  -> refreshToken을 이용해 새로운 AccessToken을 얻기 위해 서버에 비동기 요청을 보냄
                const response = await apiClient.post(
                    '/bonbon/user/refresh', // 해당 URL로 post 요청을 보낼거다  
                    null,   // 근데 Data는 없다
                    {   // config 설정은 이러하다. -> 헤더에 Bearer ${refreshToken} 형태로 토큰을 담아서 보낼 예정이다.
                        headers: {
                            'Authorization': `Bearer ${refreshToken}`
                        },
                        _skipInterceptor: true
                    }
                );

                // 새로운 accessToken 받기
                const accessToken = response.data.accessToken;
                // 새 액세스 토큰을 로컬 스토리지에 저장
                localStorage.setItem('accessToken', accessToken);
                const parsedToken = parseJwt(accessToken);

                const authStore = useAuthStore();
                authStore.isLoggedIn = true;
                authStore.userInfo.username = parsedToken.username;
                authStore.userInfo.role = parsedToken.role;

                // const userNameResponse = await apiClient.get(
                //     '/user/user-name',
                //     {
                //         headers: { 
                //             'Authorization': `Bearer ${response.data.accessToken}` 
                //         }
                //     }
                // );
                // authStore.userInfo.name = userNameResponse.data;

                // 원래 요청을 재시도
                return apiClient(originalRequest);
                
            } catch (error) {
                // 리프레시 토큰이 만료된 경우, 로그아웃 처리
                // const authStore = useAuthStore();

                const authStore = useAuthStore();
                authStore.logout();

                return Promise.reject(error);
            }
        }

        return Promise.reject(error);
    }
);

// axios 객체로 apiClient 를 반환
export default apiClient;


const parseJwt = (token) => {
    try {
        const base64Url = token.split('.')[1];
        // JWT의 페이로드 부분을 디코딩할 때 URL 안전한 Base64 문자열을 일반 Base64로 변환하는 작업을 한다.
        //   - JWT 토큰은 Base64 URL 안전한 방식으로 인코딩된다.
        //   - Base64 URL 안전 인코딩은 URL과 파일 경로에서 사용할 수 있도록 몇 가지 문자를 수정한 Base64 인코딩 방식이다.
        //     (- 대신 +, _ 대신 /)
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        
        return JSON.parse(jsonPayload)
    } catch (e) {
        return null
    }
};
