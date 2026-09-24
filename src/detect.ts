// 기기 안에서만 도는 판별기. AI 호출 전에 먼저 실행된다.
// (민감정보는 여기서 걸러져 AI로 절대 가지 않는다)

const URL_RE = /https?:\/\/[^\s<>"']+/i;

export function findUrl(text: string): string | null {
  return text.match(URL_RE)?.[0].replace(/[),.]+$/, "") ?? null;
}

/** 링크가 중심인 메모인지: URL이 있고 나머지 글이 짧으면 북마크로 본다 */
export function asLink(text: string): { url: string; note: string } | null {
  const url = findUrl(text);
  if (!url) return null;
  const note = text.replace(url, "").replace(/\s+/g, " ").trim();
  return note.length <= 80 ? { url, note } : null;
}

export function siteOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^(www|m)\./, "");
  } catch {
    return url;
  }
}

const LINK_RULES: [RegExp, string][] = [
  [/youtube\.com|youtu\.be|tv\.naver|vimeo|tangotube/, "영상"],
  [/instagram\.com|threads\.net|x\.com|twitter\.com|facebook\.com|tiktok/, "SNS"],
  [/airbnb|booking\.com|agoda|yanolja|goodchoice|stay|hotel|trip|travel|forest\.co/, "여행·숙소"],
  [/wanted\.co|saramin|jobkorea|linkedin|rallit|miniintern|openknowl|remember|jumpit|career/, "커리어"],
  [/brunch\.co|blog|tistory|velog|medium\.com|maily\.so|surfit|newneek|notion\.site|substack|pm$|productcompass/, "읽을거리"],
  [/steampowered|nintendo|playstation|overwolf|thunderstore|minehut|game/, "게임"],
  [/musinsa|coupang|smartstore|shopping|iloom|29cm|ably|zigzag|kurly|product|goods|shop|store\.|bikibiki|marhenj/, "쇼핑"],
  [/netflix|watcha|tving|wavve|disneyplus|kinolights/, "보고 싶은 것"],
  [/docs\.google|forms\.gle|figma\.com|notion\.so|drive\.google|canva/, "문서·도구"],
  [/map\.naver|kko\.to|map\.kakao|place\.|naver\.me\/.*지도/, "장소"],
  [/inflearn|fastcampus|class101|udemy|coursera|classu/, "배움"],
  [/toss\.im|kakaobank|bank/, "금융"],
];

export function classifyLinkLocally(url: string, note: string): string {
  const hay = `${url} ${note}`.toLowerCase();
  for (const [re, cat] of LINK_RULES) if (re.test(hay)) return cat;
  if (/지도|카페|맛집|장소/.test(note)) return "장소";
  if (/숙소|여행|스테이/.test(note)) return "여행·숙소";
  return "기타 링크";
}

// ---------- 민감정보 ----------

const SENSITIVE: [RegExp, string][] = [
  [/(비밀번호|비번|패스워드|password|\bpw\b|\bpwd\b|인증서\s*(비번|암호)?)\s*[:：=]?/i, "비밀번호"],
  [/\d{6}\s*-\s*[1-4]\d{6}|\d{6}\s*\/\s*(남|여)/, "주민번호"],
  [/\b(?:\d{4}[- ]){3}\d{4}\b/, "카드번호"],
  [/\bP\d{12}\b/, "개인통관고유부호"],
  [/(은행|뱅크|계좌|예금주|농협|신협|새마을|우체국|증권)[\s\S]{0,20}?\d{2,6}[\s-]?\d{2,6}[\s-]?\d{2,8}/, "계좌"],
  [/\d{3,6}-\d{2,6}-\d{4,8}[^\n]{0,15}(은행|뱅크|예금주)/, "계좌"],
  [/\bid\s*[:：]\s*\S+[\s\S]{0,40}\bpw\b/i, "계정"],
];

/** 민감정보가 있으면 종류를 돌려준다 */
export function detectSensitive(text: string): string | null {
  for (const [re, kind] of SENSITIVE) if (re.test(text)) return kind;
  return null;
}

// ---------- 연재 ----------

const SERIES_RE = /^\s*([^\d\n][^\n]{0,20}?)\s*(\d{1,4})\s*(회차|주차|일차|번째|회|차|화|편)(?![\p{L}])/u;

export function parseSeries(text: string): { name: string; n: number; unit: string } | null {
  const m = text.split("\n")[0].match(SERIES_RE);
  if (!m) return null;
  const name = m[1].replace(/[\s:：\-–·|#]+$/, "").replace(/\s+(약|제|총|대략)$/, "").trim();
  return name ? { name, n: Number(m[2]), unit: m[3] } : null;
}

// ---------- 날짜 · 할 일 ----------

const DAY = 86_400_000;

function at(d: Date, h: number, min = 0) {
  const x = new Date(d);
  x.setHours(h, min, 0, 0);
  return x;
}

/** 글에서 기한을 찾는다. 시각이 없으면 그날 오전 9시 */
export function parseDue(text: string, now = new Date()): { due: number; hasTime: boolean } | null {
  let date: Date | null = null;
  let m: RegExpMatchArray | null;
  if ((m = text.match(/(20\d{2})[.\-/]\s?(\d{1,2})[.\-/]\s?(\d{1,2})/))) date = new Date(+m[1], +m[2] - 1, +m[3]);
  else if ((m = text.match(/(?<![\d/])(\d{1,2})\s*[/월]\s*(\d{1,2})\s*일?(?![\d/])/))) {
    const [mo, d] = [+m[1], +m[2]];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      date = new Date(now.getFullYear(), mo - 1, d);
      if (date.getTime() < now.getTime() - 30 * DAY) date.setFullYear(date.getFullYear() + 1);
    }
  } else if (/오늘(?!의)/.test(text)) date = new Date(now);
  else if (/내일/.test(text)) date = new Date(now.getTime() + DAY);
  else if (/모레/.test(text)) date = new Date(now.getTime() + 2 * DAY);
  else if (/(이번\s*)?주말/.test(text)) date = new Date(now.getTime() + ((6 - now.getDay() + 7) % 7 || 7) * DAY);
  else if (/다음\s*주/.test(text)) date = new Date(now.getTime() + ((8 - now.getDay()) % 7 || 7) * DAY);

  let hour: number | null = null;
  let min = 0;
  if ((m = text.match(/(오전|오후|저녁|밤|아침)?\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분|(반))?/))) {
    hour = +m[2];
    min = m[3] ? +m[3] : m[4] ? 30 : 0;
    if (/오후|저녁|밤/.test(m[1] ?? "") && hour < 12) hour += 12;
    else if (!m[1] && hour >= 1 && hour <= 7) hour += 12; // "2시"는 보통 오후
  } else if ((m = text.match(/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/))) {
    hour = +m[1];
    min = +m[2];
  }
  if (hour !== null && hour > 23) hour = null;

  if (!date && hour === null) return null;
  if (!date) {
    date = at(now, hour!, min);
    if (date.getTime() < now.getTime()) date = new Date(date.getTime() + DAY);
    return { due: date.getTime(), hasTime: true };
  }
  return hour === null ? { due: at(date, 9).getTime(), hasTime: false } : { due: at(date, hour, min).getTime(), hasTime: true };
}

const ACTION_END = /(하기|해야\s*함|해야지|예약|확인|신청|입금|납부|결제|챙기기|사기|보내기|정리하기|제출|연락|취소|변경|등록|까지)\s*[!.]?$/;

// "~하려고 하기", "~않도록 하기" 같은 조언·피드백 문장은 할 일이 아니다
const ADVICE = /하려고|노력|않도록|않기|말기|해야\s*함|해야함|느낌|생각/;

function isTodoLine(l: string) {
  return l.length <= 30 && ACTION_END.test(l) && !ADVICE.test(l);
}

function cleanLine(l: string) {
  return l.replace(/^\s*(?:[-•*·]|\d+[.)]|v\s|\[\s?\])\s*/, "").trim();
}

/** 규칙 기반 할 일 추출 (AI가 없을 때) */
export function extractTodosLocally(text: string, now = new Date()) {
  // 연재 기록(수업·운동 일지)은 할 일로 보지 않는다. "v "로 시작하는 줄은 이미 한 일
  if (parseSeries(text)) return [];
  const lines = text
    .split("\n")
    .filter((l) => !/^\s*v\s/i.test(l))
    .map(cleanLine)
    .filter(Boolean);
  const todos: { title: string; due: number | null; hasTime: boolean }[] = [];
  const whole = parseDue(text, now);
  if (lines.length === 1) {
    if (isTodoLine(lines[0]) || (whole && lines[0].length <= 40)) todos.push({ title: lines[0], due: whole?.due ?? null, hasTime: whole?.hasTime ?? false });
    return todos;
  }
  for (const l of lines) {
    if (!isTodoLine(l)) continue;
    const d = parseDue(l, now);
    todos.push({ title: l, due: d?.due ?? null, hasTime: d?.hasTime ?? false });
  }
  return todos;
}
