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
  else if ((m = text.match(/(다음\s*주\s*)?([월화수목금토일])요일/))) {
    const target = "일월화수목금토".indexOf(m[2]);
    // "금요일" → 이번 주 금요일(지났으면 다음 주), "다음 주 월요일" → 다음 주(월요일 시작)의 그 요일
    const diff = m[1]
      ? ((8 - now.getDay()) % 7 || 7) + ((target + 6) % 7)
      : (target - now.getDay() + 7) % 7;
    date = new Date(now.getTime() + diff * DAY);
  } else if (/(이번\s*)?주말/.test(text)) date = new Date(now.getTime() + ((6 - now.getDay() + 7) % 7 || 7) * DAY);
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

// ---------- 할 일 판별: 신호마다 점수를 더하고 빼서 2점 이상이면 할 일 ----------

/** 할 일 표시: TODO, [ ], □ */
const MARKER = /^\s*(?:todo|to-do|할\s*일)\s*[:：]|^\s*(?:todo)\b|^\s*(?:-\s*)?\[\s?\]|^\s*[□☐]/i;
/** 해야 한다는 말 (문장 끝) */
const OBLIGATION = /(해야|사야|가야|봐야|받아야|내야|챙겨야|넣어야|보내야|줘야|와야|써야|바꿔야|알아봐야|끝내야)\s*(함|해|돼|됨|지|겠다|하는데|할\s*듯|되는데|겠네)?[.!~]*$/;
const DONT_FORGET = /잊지\s*말|까먹지\s*말|잊지말|까먹지말|^꼭\s|꼭\s*해야/;
/** 스스로에게 하는 권유: ~하자, ~할 것 */
const INTENT = /(자|할\s*것|할것|해야지|해야겠다|하기로)[.!~]*$/;
/** 동사 + 기 (문닫기, 사기, 맡기기 …) */
const VERB_GI = /(하|사|가|오|주|내|보|두|놓|받|떼|닫|열|끄|켜|넣|빼|찾|치우|버리|바꾸|채우|돌리|맡기|보내|먹|씻|읽|쓰|듣|걸|챙기|갈|붙이|말리|개|알아보|찾아보|물어보)기[.!~]*$/;
/** 할 일로 흔한 행동 명사 (문장 끝) */
const ACTION_NOUN = /(예약|예매|확인|신청|접수|입금|이체|송금|납부|결제|청구|제출|첨부|연락|답장|회신|전화|문자|메일|취소|변경|등록|반납|반품|교환|수선|수리|갱신|발급|신고|구매|주문|정리|처리|준비|방문|상담|검진|진료|면접|미팅|회의|밋업|약속|마감|장보기|청소|빨래|설거지)[.!~]*$/;
/** 일정이 되는 명사 (날짜·시간과 함께면 할 일) */
const EVENT = /치과|병원|진료|검진|면접|미팅|회의|밋업|약속|예약|수업|레슨|결혼식|돌잔치|장례|생일|마감|시험|발표|모임|출장|비행|기차|공연|전시|세미나|컨퍼런스|행사|파티/;
const DEADLINE = /(\d\s*일|\d{1,2}\s*[/.]\s*\d{1,2}|요일|주말|오늘|내일|모레|이번\s*주|다음\s*주|월말|연말|퇴근\s*전|점심\s*전)\s*까지|마감|~\s*\d{1,2}\s*[/.]\s*\d{1,2}|\bD-\d+/i;
/** 할 일이 아닌 쪽: 지난 일, 바람, 감상, 조언·피드백 */
const PAST = /(했다|했음|했어|였다|었다|았다|왔다|갔다|봤다|받음|받았다|다녀옴|다녀왔다|끝남|끝냈다|완료|했네|였음|좋았다|좋았음)[.!~]*$/;
const WISH = /(싶다|싶어|싶네|싶음|고프다|좋겠다)[.!~]*$/;
const STATEMENT = /(좋다|싫다|같다|같음|이다|있다|없다|된다|한다|한다고|듯|네|구나|군|ㅋ+|ㅎ+)[.!~]*$/;
const ADVICE = /하려고|노력|생각할|라고\s*생각|않도록|안\s*되게|않게|않기|(?<!잊지\s?|까먹지\s?)말기|말\s*것|느낌|생각해야|생각하며|의식하/;

const DATE_HINT = /(\d{1,2}\s*[/월]\s*\d{1,2})|오늘|내일|모레|주말|다음\s*주|[월화수목금토일]요일|\d{1,2}\s*시|\d{1,2}:\d{2}/;

function scoreLine(raw: string, now: Date): number {
  // 끝에 붙은 따옴표 · 괄호 · 이모지 · 문장부호는 떼고 문장 끝을 본다
  const l = raw.trim().replace(/[\s"'”’」』)\]!.~…\p{Extended_Pictographic}\uFE0F]+$/u, "");
  if (!l) return -9;
  let s = 0;
  if (MARKER.test(l)) s += 3;
  if (OBLIGATION.test(l) || DONT_FORGET.test(l)) s += 2;
  if (INTENT.test(l)) s += 2;
  if (VERB_GI.test(l)) s += 2;
  else if (/[가-힣]기[.!~]*$/.test(l)) s += 1;
  if (ACTION_NOUN.test(l)) s += 2;
  if (DEADLINE.test(l)) s += 2;
  if (DATE_HINT.test(l)) {
    const d = parseDue(l, now);
    if (d) s += EVENT.test(l) || (d.hasTime && l.length <= 30) ? 2 : 1;
  }
  if (PAST.test(l)) s -= 3;
  if (WISH.test(l)) s -= 3;
  if (STATEMENT.test(l)) s -= 2;
  if (ADVICE.test(l)) s -= 3;
  if (/\?\s*$/.test(l)) s -= 2;
  if (l.length > 45) s -= 2;
  // 여러 문장으로 된 글은 할 일보다 생각·기록에 가깝다
  if (/[.!?。]\s+\S/.test(l)) s -= 2;
  return s;
}

const isTodo = (l: string, now: Date) => scoreLine(l, now) >= 2;

/** 목록 머리말: "장보기", "챙길 것", "할 일:" … */
const LIST_HEADER = /^(장보기|살\s*것|사야\s*할\s*것|살\s*거|챙길\s*것|챙길\s*거|준비물|준비할\s*것|가져갈\s*것|할\s*일|할\s*것|todo|to\s*do|체크리스트|오늘\s*할\s*일)\s*[:：]?$/i;
const BULLET = /^\s*(?:[-•*·]|\d+[.)])\s*/;

function cleanLine(l: string) {
  return l
    .replace(/^\s*(?:todo|to-do)\s*[:：]?\s*/i, "")
    .replace(/^\s*(?:-\s*)?\[\s?\]\s*|^\s*[□☐]\s*/, "")
    .replace(/^\s*(?:[-•*·]|\d+[.)]|v\s)\s*/, "")
    .trim();
}

type Found = { title: string; due: number | null; hasTime: boolean };

const RECORD_HEAD = /피드백|배운\s*점|후기|정리본|스크립트|공지|안내|아이디어|오늘의\s*문장|어제의\s*문장|회고|일기|메모|느낀\s*점|수업|레슨|인텐시브|트레이닝|워크샵|강의|세미나|설문|문답/;

/** 기록 · 글에 가까운 메모인지: 길거나, 머리말이 기록류이거나, 줄이 아주 많으면 */
function isRecord(text: string, lines: string[]) {
  if (LIST_HEADER.test(lines[0])) return false;
  return text.length > 220 || lines.length > 8 || RECORD_HEAD.test(lines[0]);
}

function toTodo(title: string, dueSource: string, now: Date): Found {
  const d = parseDue(dueSource, now);
  return { title: title.slice(0, 60), due: d?.due ?? null, hasTime: d?.hasTime ?? false };
}

/** 규칙 기반 할 일 추출 (AI가 없을 때, 그리고 AI 정리 전까지) */
export function extractTodosLocally(text: string, now = new Date()): Found[] {
  // 연재 기록(수업·운동 일지)은 할 일로 보지 않는다
  if (parseSeries(text)) return [];
  // "v "로 시작하는 줄은 이미 한 일. 원래 줄과 다듬은 줄을 짝지어 둔다 (빈 글머리표 줄은 버림)
  const pairs = text
    .split("\n")
    .filter((l) => l.trim() && !/^\s*v\s/i.test(l))
    .map((raw) => ({ raw, clean: cleanLine(raw) }))
    .filter((p) => p.clean);
  if (!pairs.length) return [];
  const rawLines = pairs.map((p) => p.raw);
  const lines = pairs.map((p) => p.clean);

  if (lines.length === 1) return isTodo(rawLines[0], now) ? [toTodo(lines[0], text, now)] : [];

  // 기록형 메모(수업 피드백 · 후기 · 공지 · 아이디어 · 긴 글): 표시가 있거나 날짜+일정이 분명한 줄만 할 일
  if (isRecord(text, lines)) {
    return pairs.flatMap((p) => {
      const d = parseDue(p.raw, now);
      const explicit = MARKER.test(p.raw) || (d && (EVENT.test(p.raw) || DEADLINE.test(p.raw)) && p.clean.length <= 40 && !ADVICE.test(p.raw));
      return explicit ? [toTodo(p.clean, p.raw, now)] : [];
    });
  }

  // ① 머리말 + 항목: "장보기 / - 우유 / - 계란" → 항목마다 할 일
  const head = lines[0];
  if (LIST_HEADER.test(head)) {
    const plainHeader = /^(할\s*일|할\s*것|todo|to\s*do|체크리스트|오늘\s*할\s*일)/i.test(head);
    return lines.slice(1).map((item) => toTodo(plainHeader || isTodo(item, now) ? item : `${head.replace(/[:：]$/, "")} · ${item}`, item, now));
  }

  // ② 첫 줄이 할 일이고 나머지가 글머리표 → 세부 내용일 뿐, 할 일은 하나
  const rest = rawLines.slice(1);
  if (isTodo(rawLines[0], now) && rest.every((l) => BULLET.test(l))) return [toTodo(lines[0], text, now)];

  // ③ 마지막 줄이 "…챙기기/사기"이고 위 줄들이 짧은 이름들 → 이름마다 할 일 ("바디로션 챙기기")
  const last = lines[lines.length - 1];
  const items = lines.slice(0, -1);
  if (isTodo(last, now) && items.every((i) => i.length <= 15 && !isTodo(i, now) && !STATEMENT.test(i))) {
    const verb = last.split(/\s+/).pop()!;
    return items.map((i) => toTodo(`${i} ${verb}`, last, now));
  }

  // ④ 줄마다 따로 판단. 할 일 줄이 많은 목록이면 '~기'로 끝나는 줄도 할 일로 본다
  const scores = rawLines.map((l) => scoreLine(l, now));
  const listy = scores.filter((x) => x >= 2).length >= 2;
  return lines.flatMap((l, i) => (scores[i] >= 2 || (listy && scores[i] >= 1 && /기[.!~]*$/.test(l)) ? [toTodo(l, rawLines[i], now)] : []));
}
