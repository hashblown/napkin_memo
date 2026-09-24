// 냅킨 입력칸 글씨체. 고른 글씨체만 불러온다.

export interface FontOption {
  id: string;
  label: string;
  note: string;
  family: string;
  /** 손글씨체는 같은 크기에서 작아 보여서 키운다 */
  size: number;
  google?: string;
  css?: string;
}

const SYSTEM = `-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;

export const FONTS: FontOption[] = [
  { id: "system", label: "기본 서체", note: "기기에 들어 있는 글씨체", family: SYSTEM, size: 17 },
  {
    id: "pretendard",
    label: "Pretendard",
    note: "깔끔한 고딕",
    family: `"Pretendard Variable", Pretendard, ${SYSTEM}`,
    size: 17,
    css: "https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css",
  },
  { id: "gowun-dodum", label: "고운돋움", note: "둥글고 부드러운 고딕", family: `"Gowun Dodum", ${SYSTEM}`, size: 17, google: "Gowun+Dodum" },
  { id: "nanum-myeongjo", label: "나눔명조", note: "책 같은 명조", family: `"Nanum Myeongjo", serif`, size: 17, google: "Nanum+Myeongjo" },
  { id: "gowun-batang", label: "고운바탕", note: "단정한 명조", family: `"Gowun Batang", serif`, size: 17, google: "Gowun+Batang" },
  { id: "nanum-pen", label: "나눔손글씨 펜", note: "손글씨 · 볼펜", family: `"Nanum Pen Script", cursive`, size: 24, google: "Nanum+Pen+Script" },
  { id: "gaegu", label: "개구", note: "손글씨 · 동글동글", family: `"Gaegu", cursive`, size: 21, google: "Gaegu" },
  { id: "gamja", label: "감자꽃", note: "손글씨 · 삐뚤빼뚤", family: `"Gamja Flower", cursive`, size: 21, google: "Gamja+Flower" },
  { id: "hi-melody", label: "하이멜로디", note: "손글씨 · 가볍게", family: `"Hi Melody", cursive`, size: 22, google: "Hi+Melody" },
  { id: "nanum-brush", label: "나눔손글씨 붓", note: "손글씨 · 붓펜", family: `"Nanum Brush Script", cursive`, size: 24, google: "Nanum+Brush+Script" },
];

const loaded = new Set<string>();

function addStylesheet(href: string) {
  if (loaded.has(href)) return;
  loaded.add(href);
  document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href }));
}

export function fontById(id: string | undefined) {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

/** 입력칸에 글씨체를 적용하고, 필요하면 불러온다 */
export function applyFont(id: string | undefined) {
  const f = fontById(id);
  if (f.google) addStylesheet(`https://fonts.googleapis.com/css2?family=${f.google}&display=swap`);
  if (f.css) addStylesheet(f.css);
  document.documentElement.style.setProperty("--napkin-font", f.family);
  document.documentElement.style.setProperty("--napkin-size", `${f.size}px`);
}

/** 설정 화면 미리보기용: 보여줄 글자만 담은 작은 파일로 모든 글씨체를 한 번에 불러온다 */
export function loadPreviews(sample: string) {
  const families = FONTS.filter((f) => f.google).map((f) => `family=${f.google}`).join("&");
  addStylesheet(`https://fonts.googleapis.com/css2?${families}&display=swap&text=${encodeURIComponent(sample)}`);
  FONTS.filter((f) => f.css).forEach((f) => addStylesheet(f.css!));
}
