import type { SensitiveCategory } from "../schemas/AI-12";

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
  "에서는",
  "에게서",
  "으로써",
  "으로서",
  "이라는",
  "했는데",
  "했고",
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
 * V-9g sensitive information (NFR-PRV-05): 건강, 종교, 노조, 정치, 제3자 실명·연락처.
 * Patterns favor recall: a false positive only leaves a field empty (the user
 * can type it in the preview), a miss stores sensitive text.
 */
export const SENSITIVE_PATTERNS: Readonly<Record<Exclude<SensitiveCategory, "third_party_name">, RegExp>> = {
  contact: /(?:01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|0\d{1,2}-\d{3,4}-\d{4}|[\w.+-]+@[\w-]+\.[\w.-]+)/,
  health:
    /(?:병원|진단을?\s?받|진단받|질병|질환|우울증|공황|불안\s?장애|입원|수술|투병|항암|암\s?(?:진단|투병|치료|수술)|치료를?\s?받|장애\s?(?:판정|등급)|임신|출산|유산|정신과|심리\s?상담|병가|건강\s?(?:문제|악화|상의))/,
  religion: /(?:교회|성당|사찰|신앙|기독교|천주교|불교|이슬람|무슬림|종교|목사님|신부님|스님)/,
  union: /(?:노조|노동조합|파업|단체\s?교섭|쟁의|조합원)/,
  politics: /(?:정당|지지\s?정당|선거\s?운동|당원|진보\s?성향|보수\s?성향|정치\s?성향|정치적\s?성향|촛불\s?집회|탄핵\s?집회)/,
};

const SURNAMES =
  "김|이|박|최|정|강|조|윤|장|임|한|오|서|신|권|황|안|송|류|유|전|홍|고|문|양|손|배|백|허|남|심|노|하|곽|성|차|주|우|구|민|진|나|지|엄|채|원|천|방|공|현|함|변|염|여|추|도|석|선|설|마|길|연|위|표|명|기|반|왕|금|옥|육|인|맹|제|모|탁|국|어|은|편|용|예|경|봉|사|부";
const COMPOUND_SURNAMES = "남궁|황보|제갈|선우|독고";

const TITLES = "님|씨|과장|차장|부장|팀장|실장|본부장|대리|사원|주임|매니저|선임|책임|수석|이사|대표|상무|전무|프로|선배|후배";

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
