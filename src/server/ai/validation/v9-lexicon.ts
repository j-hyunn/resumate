/**
 * Word lists for the AI-12 V-9 checks. Small, explicit, and versioned with the
 * code: a change here changes what counts as an invented fact, so add tests
 * with every edit. Spec: AI spec AI-12 V-9c…V-9g. All lists are [가정] starting
 * points (S4 plan: "스킬 사전은 작은 상수 목록에서 시작").
 */

/**
 * V-9d skill dictionary: each entry lists spellings of one technology. A value
 * mentioning any spelling passes when the cited messages contain any spelling
 * of the same entry (user says "카프카", value says "Kafka"). Lowercase; Korean
 * spellings only where the word has no common non-tech meaning.
 */
export const SKILL_DICTIONARY: readonly (readonly string[])[] = [
  ["kafka", "카프카"],
  ["kubernetes", "k8s", "쿠버네티스"],
  ["redis", "레디스"],
  ["elasticsearch", "엘라스틱서치"],
  ["spring", "스프링부트", "springboot", "spring boot"],
  ["react", "리액트"],
  ["docker", "도커"],
  ["mysql", "마이에스큐엘"],
  ["postgresql", "postgres", "포스트그레스", "포스트그레스큐엘"],
  ["mongodb", "몽고db", "몽고디비"],
  ["aws", "아마존 웹 서비스"],
  ["java", "자바"],
  ["python", "파이썬"],
  ["typescript", "타입스크립트"],
  ["javascript", "자바스크립트"],
  ["kotlin", "코틀린"],
  ["swift", "스위프트"],
  ["flutter", "플러터"],
  ["django", "장고"],
  ["terraform", "테라폼"],
  ["jenkins", "젠킨스"],
  ["github", "깃허브"],
  ["gitlab", "깃랩"],
  ["grafana", "그라파나"],
  ["prometheus", "프로메테우스"],
  ["airflow", "에어플로우"],
  ["hadoop", "하둡"],
  ["tensorflow", "텐서플로", "텐서플로우"],
  ["pytorch", "파이토치"],
  ["datadog", "데이터독"],
  ["figma", "피그마"],
  ["jira", "지라"],
  ["graphql", "그래프큐엘"],
  ["nginx", "엔진엑스"],
  ["rabbitmq", "래빗엠큐"],
  ["vue", "뷰js", "vue.js"],
  ["next.js", "nextjs", "넥스트js"],
  ["node.js", "nodejs", "노드js"],
];

/**
 * V-9d company / product name candidates: a Korean word ending with one of
 * these must appear in the cited messages ("에이비씨페이", "가나다뱅크").
 */
export const ORG_SUFFIXES: readonly string[] = [
  "페이",
  "뱅크",
  "카드",
  "증권",
  "전자",
  "테크",
  "랩스",
  "소프트",
  "시스템즈",
  "커머스",
  "모빌리티",
  "엔터테인먼트",
  "헬스케어",
  "솔루션즈",
];

/**
 * Korean particles and verb endings stripped from the end of a word before
 * V-9e compares content words (longest first). A suffix is stripped only when
 * at least two characters remain.
 * R8 (RQ-4, AI spec v4.9 V-9e): -음 체 endings ("설계함" ↔ "설계했어요") —
 * 하였음, 했었음, 되었음 (3) · 했음, 됐음, 었음, 였음, 았음 (2) · 함, 됨, 음, 임 (1),
 * each placed before every shorter entry it ends with.
 */
export const KOREAN_SUFFIXES: readonly string[] = [
  "하였습니다",
  "했었습니다",
  "했습니다",
  "됐습니다",
  "었습니다",
  "었어요",
  "했었어요",
  "했었다",
  "하였다",
  "했어요",
  "됐어요",
  "되었다",
  "되었어요",
  "합니다",
  "하였음",
  "했었음",
  "되었음",
  "에서는",
  "에게서",
  "으로써",
  "으로서",
  "이라는",
  "했는데",
  "했고",
  "했음",
  "됐음",
  "었음",
  "였음",
  "았음",
  "했다",
  "됐다",
  "해서",
  "하여",
  "하며",
  "하고",
  "하는",
  "하던",
  "했던",
  "되어",
  "되는",
  "에서",
  "에게",
  "한테",
  "으로",
  "부터",
  "까지",
  "처럼",
  "보다",
  "라는",
  "이랑",
  "해요",
  "어요",
  "아요",
  "함",
  "됨",
  "음",
  "임",
  "와",
  "과",
  "을",
  "를",
  "은",
  "는",
  "이",
  "가",
  "의",
  "에",
  "로",
  "도",
  "만",
  "요",
  "다",
];

/** V-9e function words that carry no claim (after suffix stripping). */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "그리고",
  "그래서",
  "하지만",
  "그러나",
  "또한",
  "위해",
  "위한",
  "통해",
  "대한",
  "대해",
  "관련",
  "있었",
  "있다",
  "없다",
  "하다",
  "되다",
  "했다",
  "정도",
  "당시",
  "이후",
  "이전",
  "부분",
  "경우",
  "그때",
  "그것",
  "이것",
  "저것",
  "모든",
  "각각",
  "함께",
  "같은",
  "다른",
  "많이",
  "조금",
  "직접",
  "본인",
]);

/**
 * V-9f: a sentence whose subject is the team ("우리 팀이", "저희가", "팀이").
 * Possessives without a particle ("우리 서비스", "저희 팀 서비스") do not match.
 */
export const TEAM_SUBJECT_PATTERN =
  /(?:^|[\s,.!?;:(])(?:(?:우리|저희)\s?팀(?:원들|원)?(?:이|은|에서는|에서|끼리|들이)|(?:우리|저희)(?:가|는|들이|끼리)|팀(?:원들이|원들은|원들|이|은|에서는|에서|\s?전체가)|다\s?같이|다\s?함께)(?=[\s,.!?;:)]|$)/;

/** V-9f: first-person singular markers in the quotes that settle who acted. */
export const PERSONAL_ACTOR_PATTERN = /(?:제가|저는|저 혼자|내가|나는|직접|본인이|혼자서?|제 담당|제가 맡)/;

/**
 * V-9g / V-10f / turn notice — 민감정보 판정 (NFR-PRV-05; R8 RQ-6, AI spec v4.9
 * C-7 "민감정보 판정"). Only the user's (or family's) own circumstances,
 * contact details, and real names with a title count. Work-domain words alone
 * ("병원 예약 시스템", "출산 휴가 신청 기능", "교회 출석 앱", "파업 대응 공지")
 * never count. All lists are [가정] starting points tuned by the regression
 * fixtures in v9.test.ts ("오탐 0").
 */

/** Contact details: unchanged from R4 (phone numbers, e-mail addresses). */
export const CONTACT_PATTERN = /(?:01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|0\d{1,2}-\d{3,4}-\d{4}|[\w.+-]+@[\w-]+\.[\w.-]+)/;

/**
 * First-person / family markers (C-7: 제가, 저는, 저도, 제, 본인, 개인적으로,
 * 가족, 아내, 남편, 부모님, 아이 …). A whole word, optionally followed by a
 * particle ("아내가", "부모님께서"); "아이디" is not "아이".
 */
export const PERSONAL_MARKER_PATTERN =
  /(?:^|[^가-힣])(?:제가|저는|저도|저의|저를|제게|저한테|내가|나는|나도|본인|개인적으로|가족|아내|남편|와이프|배우자|부모님|아버지|어머니|아빠|엄마|아이|아들|딸|형|누나|언니|오빠|동생)(?=$|[^가-힣]|들|이|가|은|는|도|의|를|을|께|와|과|랑|한테|에게)|(?:^|[^가-힣])제(?=\s)/;

/**
 * Other people a work sentence is about ("환자가 입원했을 때 알림"). A personal
 * phrase right after one of these (as its subject) is about them, not the user.
 */
export const THIRD_PARTY_NOUNS =
  "환자|고객|사용자|이용자|회원|직원|임직원|근로자|노동자|산모|임산부|신도|교인|성도|시민|유권자|학생|입원자|대상자|가입자|보호자|어르신|아동|피보험자";

const THIRD_PARTY_NOUN_PATTERN = new RegExp(`(?:${THIRD_PARTY_NOUNS})`);
/** The noun (+ 들 + subject particle) ends right before the phrase. */
const THIRD_PARTY_SUBJECT_BEFORE = new RegExp(`(?:${THIRD_PARTY_NOUNS})들?(?:이|가|은|는|께서|의)?\\s*$`);

const DISEASES =
  "우울증|조울증|공황\\s?장애|공황|불안\\s?장애|적응\\s?장애|불면증|번아웃|ADHD|adhd|당뇨|갑상선|난임|암";

export type PersonalCategory = "health" | "religion" | "union" | "politics";

/**
 * One personal-circumstance phrase. `kind` says where the match ends:
 * - "verb": inside the predicate word ("병가를 냄", "치료를 받았어요") — that word's ending decides.
 * - "noun": at a noun ("입원", "휴직", "조합원") — the noun must be followed by a verb or
 *   copula ending ("입원함", "휴직했어요", "조합원임"), directly or after a particle
 *   ("육아휴직을 함"); a noun followed by another noun is a work topic ("입원 환자",
 *   "휴직 중 급여", "출산 휴가 신청 기능").
 */
export type PersonalPhrase = { pattern: RegExp; kind: "verb" | "noun" };

const v = (pattern: RegExp): PersonalPhrase => ({ pattern, kind: "verb" });
const n = (pattern: RegExp): PersonalPhrase => ({ pattern, kind: "noun" });

/**
 * R8 QA-02·QA-03 (leader direction, AI spec v4.9 C-7 "민감정보 판정"): a phrase
 * counts only as the PREDICATE of a clause about the speaker.
 * - `strong`: counts when its predicate word is finite (-음 체 / -다 / -요:
 *   "입원함", "병가를 냄", "휴직했어요") or a connective with no work noun right
 *   after ("수술을 받아 3개월 쉬었음"), and the sentence has a first-person /
 *   family marker or names no other person; never when another person is its
 *   subject ("환자가 입원함").
 * - `weak`: nouns that are also work topics ("신자", "조합원", "당원", "지지 정당").
 *   They count with a marker, or as a finite copula with no other person ("천주교 신자임").
 * Never: adnominal / modifier forms ("수술을 받는 날짜", "가입한 인원", "치료받을 수
 * 있는 병원", "출산했을 때") and nouns followed by a work noun ("암 진단 AI 모델").
 */
export const PERSONAL_PHRASES: Readonly<Record<PersonalCategory, { strong: readonly PersonalPhrase[]; weak: readonly PersonalPhrase[] }>> = {
  health: {
    strong: [
      v(new RegExp(`(?:^|[^가-힣A-Za-z])(?:${DISEASES})\\s?(?:진단을?\\s?받|진단받|치료를?\\s?받|치료받|약을?\\s?먹)`)),
      v(new RegExp(`(?:^|[^가-힣A-Za-z])(?:${DISEASES})(?:을|를|이|가)?\\s?(?:앓|겪)`)),
      v(new RegExp(`(?:^|[^가-힣A-Za-z])(?:${DISEASES})(?:이|가)\\s?(?:있|생기|생겼|생김|심해|심했|심함|와서|왔)`)),
      n(new RegExp(`(?:^|[^가-힣A-Za-z])(?:${DISEASES})(?:으로|로|\\s?때문에)\\s?(?:휴직|퇴사|입원|병가|휴가|휴학)`)),
      v(new RegExp(`(?:^|[^가-힣A-Za-z])(?:${DISEASES})(?:으로|로|\\s?때문에)\\s?(?:쉬|쉼|고생|힘들)`)),
      // R8 QA-07: up to two words between the cause and the predicate ("공황장애 때문에 프로젝트에서 빠짐").
      v(new RegExp(`(?:^|[^가-힣A-Za-z])(?:${DISEASES})(?:으로|로|\\s?때문에)\\s(?:[가-힣0-9]+\\s){1,2}(?:쉬|쉼|빠졌|빠짐|빠지|그만두|그만둠|휴직|퇴사)`)),
      // "우울증 치료로 3개월 쉬었다가", "우울증 치료 중에 런북을 씀", "우울증 치료 뒤 복귀" (connectives; a work noun right after → clean).
      v(new RegExp(`(?:^|[^가-힣A-Za-z])(?:${DISEASES})\\s?(?:치료|투병)(?:\\s?(?:중에도|중에|뒤에|뒤|후에|후|이후|때문에)|로|으로)`)),
      n(/입원|휴직|휴학|투병|임신|출산|유산|간병/),
      v(/수술을?\s?받|수술받|치료를?\s?받|치료받|통원\s?치료를?\s?받/),
      // R8 QA-07: "허리 수술로 두 달 쉬었음", "수술 후 한 달 휴직함" (adnominal "쉬는 기간" stays clean).
      v(/수술(?:로|으로|\s?때문에|\s?(?:후|뒤|이후)에?)\s(?:[가-힣0-9]+\s){0,2}(?:쉬|쉼|휴직|휴학|빠졌|빠짐)/),
      // R8 QA-07: back from leave ("출산 후 복직함"); "복직 지원 제도" is a noun + noun work topic.
      n(/(?:출산|육아\s?휴직|휴직|병가|입원|수술|투병|치료)\s?(?:후|뒤|이후)에?\s?복직/),
      // R8 QA-07: during sick leave / a hospital stay ("병가 중에도 리뷰를 함"); a work noun right after stays clean.
      v(/(?:^|[^가-힣])(?:병가|입원)\s?중에도?(?![가-힣])/),
      v(/병가를?\s?(?:냈|냄|내|썼|씀|쓰|써)|병가를?\s?사용(?=했|함|하|해)/),
      v(/(?:출산|육아)\s?휴가를?\s?(?:냈|냄|내|썼|씀|쓰|써|다녀|다녀옴)/),
      v(/장애\s?(?:판정|등급)을?\s?받|심리\s?상담을?\s?받|정신과\s?(?:치료|진료)를?\s?받/),
      v(/몸이\s?(?:안\s?좋|아프|아파|아팠|아픔)|건강이\s?(?:안\s?좋|나빠|나빴|악화)/),
      n(/건강\s?(?:문제|악화|상의\s?이유)로\s?(?:휴직|퇴사|휴학)/),
      v(/건강\s?(?:문제|악화|상의\s?이유)로\s?(?:쉬|쉼|그만두|그만둠)/),
    ],
    weak: [],
  },
  religion: {
    strong: [
      v(/(?:^|[^가-힣])(?:교회|성당|절|사찰|성전|모스크)(?:에|를|을)?\s?(?:다니|다녀|다님|나가|나감|나갔|나갑|가요|가서|가고|감|갔|갑니다)/),
      v(/세례를?\s?받|예배를?\s?드리|예배를?\s?드림|미사를?\s?드리|미사를?\s?드림/),
      v(/(?:하나님|하느님|부처님|예수님|알라)을?\s?믿/),
    ],
    weak: [
      n(/(?:^|[^가-힣])신앙/),
      n(/(?:기독교|개신교|천주교|가톨릭|불교|원불교|이슬람)\s?(?:신자|신도|교인)|(?:기독교|불교|이슬람)(?:도|인)(?![가-힣])|무슬림|크리스천/),
      n(/(?:^|[^가-힣])신자/),
      v(/종교(?:가|는)\s?(?:있|없)/),
    ],
  },
  union: {
    strong: [
      n(/노조\s?(?:활동|일)을?\s?(?=하|했|함|해|합)|노동조합\s?활동을?\s?(?=하|했|함|해|합)/),
      n(/(?:노조|노동조합)에\s?가입/),
      n(/파업에\s?(?:참여|참가|동참)/),
      v(/파업에\s?(?:나가|나갔|나감)|파업을\s?(?:했|하|함|해|벌였|벌임)/),
    ],
    weak: [n(/(?:^|[^가-힣])조합원/), n(/노조\s?(?:간부|위원장|대의원|지부장|분회장)/)],
  },
  politics: {
    strong: [
      n(/선거\s?운동을?\s?(?=하|했|함|해|도)/),
      v(/선거\s?운동을?\s?(?:도왔|도와|도움)/),
      n(/(?:촛불|탄핵|정치)\s?집회에\s?(?:참여|참가)/),
      v(/(?:촛불|탄핵|정치)\s?집회에\s?(?:나가|나갔|나감)/),
      n(/(?:정당|후보)을\s?지지/),
      // R8 QA-07: "선거 캠프에서 일함" ("선거 캠프에서 쓰는 앱" has no such predicate).
      v(/선거\s?캠프에서\s?(?:일|근무|활동|봉사)/),
    ],
    weak: [n(/지지(?:하는)?\s?정당/), n(/(?:^|[^가-힣])당원/), n(/정치\s?성향|정치적\s?성향|(?:진보|보수)\s?성향/)],
  },
};

/** Work / product nouns: right after a connective predicate or a bare noun, the sentence is about work. */
export const WORK_NOUNS =
  "모델|앱|어플|플랫폼|기능|시스템|서비스|통계|데이터|대시보드|예약|관리|로직|공지|배너|화면|페이지|흐름|프로세스|콘텐츠|컨텐츠|챗봇|알림|기록|신청|조회|내역|검색|리포트|보고서|캠페인|추천|알고리즘|모듈|솔루션|도구|양식|템플릿|목록|일정|자동화|지원금|안내|정책|제도|규정|비율|현황|인원|대상|API|DB";

const WORK_NOUN_START = new RegExp(`^(?:${WORK_NOUNS})`);

/** Particles that may sit between a noun phrase and its predicate ("육아휴직을 함"). */
const PARTICLE = /^(?:을|를|이|가|은|는|도|에|에서|으로|로|만|도|까지)$/;
/** A word that starts a verb / copula after a noun ("입원함", "휴직 중임"). */
// R8 QA-07: 쓰다 forms ("육아휴직을 씀", "병가를 썼어요").
const VERBISH_START = /^(?:하|했|함|해|합|한|할|되|됐|됨|된|될|중|이었|였|임|입니|이에|예요|이라|이고|이어|씀|썼|써|쓴|쓸)/;

type WordForm = "finite" | "adnominal" | "connective";

function finalJamo(ch: string): number {
  const code = ch.charCodeAt(0) - 0xac00;
  return code >= 0 && code < 11172 ? code % 28 : -1;
}

/**
 * Ending of a predicate word: finite (-음 체 ㅁ 받침, -다, -요, -니다, -까),
 * adnominal (-는/-던, ㄴ/ㄹ 받침: "받는", "가입한", "받을"), else connective
 * ("받아", "하고", "좋아서").
 */
export function wordForm(word: string): WordForm {
  const w = word.replace(/[^가-힣]+$/, "");
  const last = w.slice(-1);
  if (!last) return "finite";
  const jong = finalJamo(last);
  if (last === "요" || last === "다" || last === "까" || jong === 16 || jong === 10) return "finite";
  if (last === "는" || last === "던" || jong === 4 || jong === 8) return "adnominal";
  return "connective";
}

const WORD_END = /[\s,.!?;:·…()\[\]{}"'“”‘’「」『』<>/~]/;

function wordEndAt(s: string, from: number): number {
  let i = from;
  while (i < s.length && !WORD_END.test(s[i])) i++;
  return i;
}

function wordStartAt(s: string, at: number): number {
  let i = at;
  while (i > 0 && !WORD_END.test(s[i - 1])) i--;
  return i;
}

function nextWord(s: string, from: number): { word: string; end: number } | null {
  let i = from;
  while (i < s.length && /\s/.test(s[i])) i++;
  if (i >= s.length || WORD_END.test(s[i])) return null;
  const end = wordEndAt(s, i);
  return { word: s.slice(i, end), end };
}

/**
 * The predicate of a match: its word form and where it ends, or null when the
 * phrase is a modifier / work topic (noun + noun, "중" + noun). `particleOk`
 * (weak phrases with a first-person marker): "제 지지 정당은 …" counts as is.
 */
function predicateOf(s: string, match: RegExpMatchArray, kind: PersonalPhrase["kind"], particleOk: boolean): { form: WordForm; end: number } | null {
  const mEnd = match.index! + match[0].length;
  const wEnd = wordEndAt(s, mEnd);
  const rest = s.slice(mEnd, wEnd);
  // Verb phrases end inside (or at the end of) the predicate word ("병가를 냄", "받았어요", "받는").
  if (kind === "verb") return { form: wordForm(s.slice(wordStartAt(s, Math.max(match.index!, mEnd - 1)), wEnd)), end: wEnd };
  if (rest !== "" && !PARTICLE.test(rest)) return VERBISH_START.test(rest) ? { form: wordForm(rest), end: wEnd } : null;
  if (rest !== "" && particleOk) return { form: "finite", end: wEnd };
  const next = nextWord(s, wEnd);
  if (!next) return rest === "" ? { form: "finite", end: wEnd } : null; // "… 3개월 휴직." (noun-final sentence)
  if (next.word === "중" || !VERBISH_START.test(next.word)) return null; // "휴직 중 급여", "입원 환자", "출산 휴가 신청"
  return { form: wordForm(next.word), end: next.end };
}

/** Sentence split for the same-sentence rule: punctuation ends and line breaks. */
export function sensitiveSentences(text: string): string[] {
  return text
    .normalize("NFKC")
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * A work noun within the next two words after `from` ("입원하고 퇴원하는 흐름").
 * R8 QA-07: after a realized cause ("입원해서", "-아서/-어서") a work noun that is
 * the next clause's subject ("일정이 밀렸음") is a consequence, not a work topic.
 */
function workNounSoon(s: string, from: number, predicate: string): boolean {
  const realizedCause = /서$/.test(predicate.replace(/[^가-힣]+$/, ""));
  let at = from;
  for (let k = 0; k < 2; k++) {
    const w = nextWord(s, at);
    if (!w) return false;
    if (WORK_NOUN_START.test(w.word)) return !(realizedCause && SUBJECT_AFTER_WORK_NOUN.test(w.word));
    at = w.end;
  }
  return false;
}

const SUBJECT_AFTER_WORK_NOUN = new RegExp(`^(?:${WORK_NOUNS})(?:이|가)[^가-힣]*$`);

function phraseCounts(s: string, phrase: PersonalPhrase, personal: boolean, otherPerson: boolean, strong: boolean): boolean {
  const flags = phrase.pattern.flags.includes("g") ? phrase.pattern.flags : `${phrase.pattern.flags}g`;
  for (const m of s.matchAll(new RegExp(phrase.pattern.source, flags))) {
    if (THIRD_PARTY_SUBJECT_BEFORE.test(s.slice(Math.max(0, m.index! - 12), m.index!))) continue;
    const pred = predicateOf(s, m, phrase.kind, !strong && personal);
    if (!pred || pred.form === "adnominal") continue;
    if (pred.form === "connective" && workNounSoon(s, pred.end, s.slice(wordStartAt(s, pred.end - 1), pred.end))) continue;
    // strong: a marker, or no other person in the sentence. weak: a marker, or a finite copula with no other person.
    if (personal || (!otherPerson && (strong || pred.form === "finite"))) return true;
  }
  return false;
}

/** Personal-circumstance categories in a text (C-7 rule above). */
export function detectPersonalCategories(text: string): PersonalCategory[] {
  const found = new Set<PersonalCategory>();
  for (const sentence of sensitiveSentences(text)) {
    const personal = PERSONAL_MARKER_PATTERN.test(sentence);
    const otherPerson = THIRD_PARTY_NOUN_PATTERN.test(sentence);
    for (const [category, phrases] of Object.entries(PERSONAL_PHRASES) as [PersonalCategory, (typeof PERSONAL_PHRASES)[PersonalCategory]][]) {
      if (found.has(category)) continue;
      if (
        phrases.strong.some((p) => phraseCounts(sentence, p, personal, otherPerson, true)) ||
        phrases.weak.some((p) => phraseCounts(sentence, p, personal, otherPerson, false))
      ) {
        found.add(category);
      }
    }
  }
  return (["health", "religion", "union", "politics"] as const).filter((c) => found.has(c));
}

const SURNAMES =
  "김|이|박|최|정|강|조|윤|장|임|한|오|서|신|권|황|안|송|류|유|전|홍|고|문|양|손|배|백|허|남|심|노|하|곽|성|차|주|우|구|민|진|나|지|엄|채|원|천|방|공|현|함|변|염|여|추|도|석|선|설|마|길|연|위|표|명|기|반|왕|금|옥|육|인|맹|제|모|탁|국|어|은|편|용|예|경|봉|사|부";
const COMPOUND_SURNAMES = "남궁|황보|제갈|선우|독고";

const TITLES = "님|씨|과장|차장|부장|팀장|실장|본부장|대리|사원|주임|매니저|선임|책임|수석|이사|대표|상무|전무|프로(?!젝트|그램|세스|덕트|필|모션|토타입|토콜|퍼티|세서|그래머)|선배|후배"; // R8 QA-08: "신사업 프로젝트" is not a title

/**
 * R8 (RQ-6) [가정]: a "surname + 2 syllables" word ending in one of these is a
 * job or organization noun, not a name ("기획자 선배", "사업부 부장님", "고객사
 * 팀장", "연구소 실장"). "원" is left out on purpose — it ends many real
 * names (지원, 혜원, 태원) — and its job nouns are listed in NOT_A_NAME instead.
 */
export const NOT_A_NAME_ENDINGS = "자부사팀실소단국과처";

/**
 * V-9g 제3자 실명: a three-syllable name (or compound surname + 1–2), then a
 * title ("김민수 팀장", "박지연님"). Two-syllable names are not matched: too many
 * words start with a surname syllable ("정산 팀장", "이번 팀장").
 */
export const THIRD_PARTY_NAME_PATTERN = new RegExp(
  `(?:^|[^가-힣])((?:${SURNAMES})[가-힣]{2}|(?:${COMPOUND_SURNAMES})[가-힣]{1,2})\\s?(?:${TITLES})`,
  "g",
);

/** Words that look like "surname + syllable" but are not names ("이번 팀장", "전임 과장"). */
export const NOT_A_NAME: ReadonlySet<string> = new Set([
  "이번",
  "이전",
  "이후",
  "전임",
  "전체",
  "전담",
  "후임",
  "신규",
  "신임",
  "기존",
  "당시",
  "현재",
  "원래",
  "다른",
  "같은",
  "우리",
  "저희",
  "해당",
  "상위",
  "직속",
  "담당",
  "소속",
  "고객",
  "고객사",
  "개발",
  "기획",
  "운영",
  "인사",
  "영업",
  "마케팅",
  "디자인",
  "정보",
  "보안",
  "성과",
  "주니어",
  "시니어",
  "부서",
  "본부",
  "유관",
  "협력",
  "외부",
  "내부",
  "한명",
  "모든",
  "각팀",
  "여러",
  "나머지",
  "선임",
  "책임",
  "수석",
  "사수",
  "부사수",
  "도와준",
  "구성원",
  "조직",
  "사업",
  "서비스",
  "제품",
  "데이터",
  "백엔드",
  "프론트",
  "인프라",
  "모바일",
  "플랫폼",
  "정말",
  "정도",
  "조금",
  "이미",
  "진짜",
  "이제",
  "우선",
  "전부",
  "최근",
  "최종",
  "신입",
  "한번",
  "공동",
  "주요",
  "기술",
  "문제",
  "결국",
  "그냥",
  "마침",
  "사실",
  "직접",
  "함께",
  "같이",
  "당연",
  "모두",
  "임시",
  "정식",
  "전사",
  "전략",
  "기술",
  "주로",
  "연구",
  "안정",
  "조직장",
  "부장급",
  "차기",
  // Titles that themselves start with a surname syllable ("부장님", "이사님", "주임님").
  "부장",
  "차장",
  "이사",
  "전무",
  "주임",
  "원장",
  "사장",
  "사원",
  "회장",
  "감독",
  "교수",
  "선생",
  "기사",
  "부모",
  "동료",
  "상사",
  "선배",
  "후배",
  "고문",
  "위원",
  "연구원",
  "사무원",
  "공무원",
  "상담원",
  "교직원",
  "대학원",
  "매니저",
  "본부장",
  "실장",
  "팀장",
]);

/**
 * "알아서 채워 줘" (AI-12 가드레일): a message asking the AI to invent content.
 * Patches whose only sources are such messages are rejected.
 */
export const DELEGATION_PATTERN =
  /(?:알아서|그럴듯하게|그럴싸하게|적당히|대충|임의로|있어\s?보이게|아무렇게나).{0,12}(?:채워|써\s?줘|써줘|써\s?주|작성해|만들어|넣어|지어|꾸며)|(?:지어내|지어서|꾸며서|꾸며\s?줘)/;

/** Native Korean counting words → numbers, for V-9c ("네 명" = 4명). */
export const NATIVE_COUNT_WORDS: Readonly<Record<string, number>> = {
  한: 1,
  두: 2,
  세: 3,
  네: 4,
  다섯: 5,
  여섯: 6,
  일곱: 7,
  여덟: 8,
  아홉: 9,
  열: 10,
  열한: 11,
  열두: 12,
  스무: 20,
};

/** Counters that may follow a native counting word. */
export const NATIVE_COUNTERS = "명|개|번|가지|달|해|분|팀|곳|건|대";
