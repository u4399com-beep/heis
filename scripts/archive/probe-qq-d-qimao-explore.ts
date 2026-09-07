/** qq-d: 七猫 leader-board/分类分页探测 + is_over 语义 + 网文候选书 content 验证 */
import { createHash, createDecipheriv } from "node:crypto";

const KEY = "d3dGiJc651gSQ8w1";
const AES_KEY = "242ccb8230d709e1";
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const H = {
  "app-version": "80400", platform: "android", reg: "0", AUTHORIZATION: "",
  "application-id": "com.kmxs.reader", "net-env": "1", channel: "unknown", "qm-params": "",
};
const hs = { ...H, sign: md5(Object.keys(H).sort().reduce((p, n) => p + n + "=" + H[n], "") + KEY) };
const signP = (p: Record<string, string | number>) => md5(Object.keys(p).sort().reduce((p2, n) => p2 + n + "=" + String(p[n]), "") + KEY);
const ue = (p: Record<string, string | number>) => Object.entries(p).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

async function getJSON(url: string) {
  const res = await fetch(url, { headers: hs });
  const j = await res.json().catch(() => null);
  return { status: res.status, j };
}

// ═══ 1. leader-board 排行榜: 形态 + page 分页支持 ═══
const lbp = { rank_type: "hot_list", category_id: 0, tab_type: 1, category_type: 0, imei_ip: "2937357107", book_privacy: 1, read_preference: 0 };
for (const pg of [1, 2]) {
  const { j } = await getJSON(`https://api-bc.wtzw.com/api/v1/leader-board?${ue({ ...lbp, page: pg, sign: signP({ ...lbp, page: pg }) })}`);
  const d = j?.data;
  const books = d?.books || d?.data || [];
  console.log(`leader-board page=${pg}: keys=${Object.keys(d || {}).join(",")} | books=${Array.isArray(books) ? books.length : typeof books} | first=${JSON.stringify(Array.isArray(books) ? books[0] : null).slice(0, 220)}`);
}

// ═══ 2. category 分类页分页 ═══
const cp = { gender: 1, category_id: 202, need_filters: 0, need_category: 0, words: -99, sort: 0, over: -99, imei_ip: "2937357107", page: 1 };
for (const pg of [1, 2]) {
  const { j } = await getJSON(`https://api-bc.wtzw.com/category?${ue({ ...cp, page: pg, sign: signP({ ...cp, page: pg }) })}`);
  const books = j?.data?.books || [];
  console.log(`category page=${pg}: status_keys=${Object.keys(j || {}).join(",")} books=${books.length} first=${JSON.stringify(books[0] || null).slice(0, 200)}`);
}

// ═══ 3. 网文候选: 搜索热门长书, 验证 content 为文本且 ≥100 章 ═══
for (const wd of ["神医娘亲", "万古神帝", "一级律师", "重生八零"]) {
  const sp = { gender: "3", imei_ip: "2937357107", page: 1, wd };
  const { j } = await getJSON(`https://api-bc.wtzw.com/search/v1/words?${ue({ ...sp, sign: signP(sp) })}`);
  const books = j?.data?.books || [];
  if (!books.length) { console.log(`wd=${wd}: 0`); continue; }
  const b = books[0];
  const bid = String(b.id);
  const t = await getJSON(`https://api-ks.wtzw.com/api/v1/chapter/chapter-list?${ue({ id: bid, sign: signP({ id: bid }) })}`);
  const list = t.j?.data?.chapter_lists || [];
  const cid = String(list[0]?.id ?? "");
  const c = await getJSON(`https://api-ks.wtzw.com/api/v1/chapter/content?${ue({ id: bid, chapterId: cid, sign: signP({ id: bid, chapterId: cid }) })}`);
  let verdict = "N/A";
  try {
    const blob = Buffer.from(c.j?.data?.content || "", "base64");
    const d = createDecipheriv("aes-128-cbc", Buffer.from(AES_KEY, "utf8"), blob.subarray(0, 16));
    const plain = Buffer.concat([d.update(blob.subarray(16)), d.final()]).toString("utf8");
    verdict = plain.slice(0, 2) === "PK" ? "EPUB(出版)" : `TEXT(${plain.length}字) "${plain.slice(0, 40).replace(/\n/g, "|")}"`;
  } catch (e) { verdict = "ERR " + String(e).slice(0, 60); }
  console.log(`wd=${wd}: ${bid} "${b.original_title}" by ${b.original_author} | source=${b.source || "null"} | 章节=${list.length} | ch1 content: ${verdict}`);
}

// ═══ 4. is_over 语义 + content 响应键 ═══
{
  const dp = { id: "1840436", imei_ip: "2937357107", teeny_mode: 0 };
  const { j } = await getJSON(`https://api-bc.wtzw.com/api/v4/book/detail?${ue({ ...dp, sign: signP(dp) })}`);
  const b = j?.data?.book || {};
  console.log("detail is_over=", JSON.stringify(b.is_over), "type=", b.type, "category1_name=", b.category1_name, "category2_name=", b.category2_name, "chapters=", b.chapters);
  const c = await getJSON(`https://api-ks.wtzw.com/api/v1/chapter/content?${ue({ id: "1840436", chapterId: "1", sign: signP({ id: "1840436", chapterId: "1" }) })}`);
  console.log("content response data keys:", Object.keys(c.j?.data || {}).join(","));
}

export {};
