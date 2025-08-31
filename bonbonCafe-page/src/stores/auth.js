import apiClient from "@/api";  // HTTP 클라이언트 
import { defineStore } from "pinia";    // pinia를 사용해 인증 관리를 담당하는 스토어 정의
import { reactive, ref, onMounted } from "vue";
import { useRouter } from "vue-router";     // 페이지 이동을 위한 vue-router


// 스토어 이름 : 'auth'
export const useAuthStore = defineStore('auth', () => {
    
    // 페이지 이동 router 
    const router = useRouter();

    // 로그인 여부 저장
    const isLoggedIn = ref(false);

    // 사용자 정보 저장 -> reactive 객체
    const userInfo = reactive({
        username: '',   // 이메일
        name: '',   // 본명
        userImage: '',
        role: ''    // 권한
    });

    // 페이지 로드 시 로그인 여부 확인
    onMounted(() => {
        checkLogin(); // 로그인 여부 확인
    });
    
    
    // 로그인 함수
    const login = async (loginData) => {
        // loginData -> LoginForm.vue에서 받아옴
        console.log(loginData);

        try {
            // 사용자 입력 loginData를 해당 엔드포인트로 POST 요청을 보냄
            const response = await apiClient.post('/bonbon/user/login', loginData);

            // 로그인에 성공하는 경우, 
            if(response.status === 200) {
                console.log(response);
                
                const userNameResponse = await apiClient.get(
                    '/bonbon/user',
                    {
                        headers: { 
                            'Authorization': `Bearer ${response.data.accessToken}` 
                        }
                    }
                );
                console.log(userNameResponse.data);

                const parseToken = parseJwt(response.data.accessToken);

                // 토큰들을 로컬 스토리지에 저장 + 사용자 정보도 로컬에 저장함
                localStorage.setItem('accessToken', response.data.accessToken);
                localStorage.setItem('refreshToken', response.data.refreshToken);
                localStorage.setItem('userInfo', JSON.stringify({
                    username: parseToken.username,
                    name: userNameResponse.data.name,
                    userImage: userNameResponse.data.userImage,
                    role: parseToken.role
                }));

                // userInfo 객체 업데이트
                Object.assign(userInfo, JSON.parse(localStorage.getItem('userInfo')));

                console.log(userInfo.data);

                // 로그인 상태 변경
                isLoggedIn.value = true;

                // 홈 페이지로 리다이렉트 함
                router.push({name: 'main'});
            }
        } catch (error) {
            // 로그인 실패 처리 -> 에러 핸들링
            if (error.response.data.code === 400) {
                console.log(response);
                alert(error.response.data.message);
            } else {
                // 401 이외의 오류 발생 시 일반적인 에러 메시지 표시
                alert(error.response.data.message);
                // alert('에러가 발생했습니다.');
            }
        }
    };

    // 새로고침 시 Pinia 상태가 초기화되므로 로그인 유지 위해 추가
    const checkLogin = () => {
        
        if (localStorage.getItem('accessToken')) {
            // localStorage는 클라이언트 측 저장소 -> 새로고침 시에도 데이터 유지
            // -> accessToken이 존재하는 경우, -> isLoggedIn 상태를 true로 만들어주면 됨
            const savedUserInfo = JSON.parse(localStorage.getItem('userInfo'));
            
            userInfo.username = savedUserInfo.username;
            userInfo.name = savedUserInfo.name;
            userInfo.role = savedUserInfo.role;
            userInfo.userImage = savedUserInfo.userImage;

            isLoggedIn.value = true;
        } else {
            // accessToken 없으면 그냥 false로 만들어둠
            isLoggedIn.value = false;
        }
    };

    // 사용자 로그아웃 시
    const logout = async () => {
        if(!isLoggedIn){
            return;
        }

        try {
            // localStorage에서 accessToken 먼저 가져오기
            const accessToken = localStorage.getItem('accessToken');
            console.log(accessToken);

            if (!accessToken || isInvalidAccessToken(accessToken)) {
                // accessToken이 유효하지 않는 경우, 토큰이 존재하지 않는 경우
                if(isLoggedIn.value){
                    alert('다시 로그인해 주세요.');
                    logoutUser();   
                }
                return;
            }

            // 토큰이 유효한 경우 -> 로그아웃 api 호출
            const response = await apiClient.post(
                '/bonbon/user/logout',
                null,
                {  
                     headers: {
                        'Authorization': `Bearer ${accessToken}`
                    },
                    _skipInterceptor: true
                }
              );

            // 로그아웃이 잘 된 경우,
            if (response.status === 204) {
                logoutUser();
            }

        } catch (error) {
            logoutUser();
        }
    };

    const logoutUser = () => {
        // 토큰들을 로컬 스토리지에 삭제
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('userInfo');

        // 로그인 상태를 변경한다.
        isLoggedIn.value = false;

        // 사용자 정보를 지운다.
        userInfo.username = '';
        userInfo.role = '';
        userInfo.name = '';
        userInfo.userImage = '';

        // 로그인 페이지로 리다이렉트
        router.push({name: 'login'});
    };

    // 액세스 토큰 유효성 검사 함수
    const isInvalidAccessToken = (token) => {
        try {
            const decoded = parseJwt(token); // JWT 디코딩
            const currentTime = Math.floor(Date.now() / 1000);  // 현재 시간을 초 단위로 계산

            return decoded.exp <= currentTime;  // 만료 시간이 현재 시간보다 크면 유효
        } catch (error) {
            return false;  // 토큰 디코딩에 실패하면 유효하지 않다고 판단
        }
    }

    // defineStore로 정의한 스토어가 외부에서 사용할 수 있도록 필요한 값들을 반환하는 방식
    return { isLoggedIn, userInfo, login, checkLogin, logout };
});


export const parseJwt = (token) => {
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