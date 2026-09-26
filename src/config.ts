// 동기화 서버(Supabase) 주소와 공개 키.
// 공개 키(anon key)는 브라우저에 노출돼도 되는 값이다. 데이터는 로그인한 본인만 읽고 쓸 수 있게 DB에서 막는다.
// 빌드할 때 환경 변수(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)로 넣거나, 아래에 직접 적는다.
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
