/** qq-d: 七猫官方 API 探测 — sign 强制性甄别 + AES 解密验证 (对照 Legado 书源 7698) */
import { createHash } from "node:crypto";

const KEY = "d3dGiJc651gSQ8w1";
const AES_KEY = "242ccb8230d709e1";
const BASE_BC = "https://api-bc.wtzw.com";
const BASE_KS = "https://api-ks.wtzw.com";

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

// Legado 书源的两套 headers (search 用 qm-xiaomi_If, detail/toc/content 用 unknown)
const HEADERS_SEARCH = {
  "app-version": "80400", platform: "android", reg: "0", AUTHORIZATION: "",
  "application-id": "com.kmxs.reader", "net-env": "1", channel: "qm-xiaomi_If", "qm-params": "",
};
const HEADERS_UNK = {
  "app-version": "80400", platform: "android", reg: "0", AUTHORIZATION: "",
  "application-id": "com.kmxs.reader", "net-env": "1", channel: "unknown", "qm-params": "",
};

function signedHeaders(h: Record<string, string>): Record<string, string> {
  const sign = md5(Object.keys(h).sort().reduce((pre, n) => pre + n + "=" + h[n], "") + KEY);
  return { ...h, sign };
}

function signParams(p: Record<string, string | number>): string {
  const sorted = Object.keys(p).sort();
  const raw = sorted.reduce((pre, n) => pre + n + "=" + String(p[n]), "") + KEY;
  return md5(raw);
}

function urlEncode(p: Record<string, string | number>): string {
  return Object.entries(p).map(([k, v]) => `&${k}=${encodeURIComponent(String(v))}`).join("").slice(1);
}

async function call(label: string, url: string, headers: Record<string, string>, withHeaders: boolean) {
  try {
    const res = await fetch(url, {
      headers: withHeaders ? { ...signedHeaders(headers), "user-agent": "okhttp/3.12.0" } : { "user-agent": "okhttp/3.12.0" },
    });
    const text = await res.text();
    let head = text.slice(0, 200).replace(/\n/g, " ");
    try { head = JSON.stringify(JSON.parse(text)).slice(0, 200); } catch { /* raw */ }
    console.log(`[${label}] ${res.status} len=${text.length} ${head}`);
    return { status: res.status, text };
  } catch (e) {
    console.log(`[${label}] ERR ${String(e).slice(0, 150)}`);
    return { status: -1, text: "" };
  }
}

// ═══ 1. 搜索 /search/v1/words ═══
const sp = { gender: "3", imei_ip: "2937357107", page: 1, wd: "我在末世变废为宝" };
await call("search-nosign-nosignH", `${BASE_BC}/search/v1/words?${urlEncode(sp)}`, HEADERS_SEARCH, false);
await call("search-sign-H", `${BASE_BC}/search/v1/words?${urlEncode({ ...sp, sign: signParams(sp) })}`, HEADERS_SEARCH, true);

// 拿一个 book id
let bookId = "";
const sr = await call("search-again", `${BASE_BC}/search/v1/words?${urlEncode({ ...sp, sign: signParams(sp) })}`, HEADERS_SEARCH, true);
if (sr.text) {
  try {
    const j = JSON.parse(sr.text);
    const books = j?.data?.books || [];
    console.log("search books count:", books.length, "| first:", books[0]?.original_title, books[0]?.id, books[0]?.original_author);
    bookId = String(books[0]?.id ?? "");
  } catch { /* */ }
}
if (!bookId) bookId = "87176001"; // fallback: 书源 checkKeyWord 样例
console.log("== bookId =", bookId);

// ═══ 2. 详情 /api/v4/book/detail ═══
const dp = { id: bookId, imei_ip: "2937357107", teeny_mode: 0 };
await call("detail-nosign", `${BASE_BC}/api/v4/book/detail?${urlEncode(dp)}`, HEADERS_UNK, false);
const dr = await call("detail-sign", `${BASE_BC}/api/v4/book/detail?${urlEncode({ ...dp, sign: signParams(dp) })}`, HEADERS_UNK, true);
if (dr.text) {
  try {
    const b = JSON.parse(dr.text)?.data?.book;
    console.log("detail keys:", Object.keys(b || {}).join(","));
    console.log("detail: title=", b?.title, "| author=", b?.author, "| category=", b?.category_over_words, "| words=", b?.words_num, "| latest=", b?.latest_chapter_title, "| score=", b?.attribute?.score, "| intro len=", (b?.intro || "").length, "| cover=", (b?.image_link || "").slice(0, 80));
  } catch { /* */ }
}

// ═══ 3. 目录 chapter-list (api-ks) ═══
const tp = { id: bookId };
await call("toc-nosign", `${BASE_KS}/api/v1/chapter/chapter-list?${urlEncode(tp)}`, HEADERS_UNK, false);
const tr = await call("toc-sign", `${BASE_KS}/api/v1/chapter/chapter-list?${urlEncode({ ...tp, sign: signParams(tp) })}`, HEADERS_UNK, true);
let firstCid = "";
if (tr.text) {
  try {
    const j = JSON.parse(tr.text);
    const list = j?.data?.chapter_lists || [];
    console.log("toc chapters:", list.length, "| first item:", JSON.stringify(list[0]).slice(0, 300));
    console.log("toc item keys:", Object.keys(list[0] || {}).join(","));
    firstCid = String(list[0]?.id ?? "");
  } catch { /* */ }
}

// ═══ 4. 正文 content + AES 解密 ═══
if (firstCid) {
  const cp = { id: bookId, chapterId: firstCid };
  await call("content-nosign", `${BASE_KS}/api/v1/chapter/content?${urlEncode(cp)}`, HEADERS_UNK, false);
  const cr = await call("content-sign", `${BASE_KS}/api/v1/chapter/content?${urlEncode({ ...cp, sign: signParams(cp) })}`, HEADERS_UNK, true);
  if (cr.text) {
    try {
      const j = JSON.parse(cr.text);
      const content = j?.data?.content || "";
      console.log("content field len:", content.length, "| head 60:", content.slice(0, 60));
      // Legado decode(): base64 → IV=前16字节 + AES-128-CBC/PKCS5 key=242ccb8230d709e1
      const { createDecipheriv } = await import("node:crypto");
      const blob = Buffer.from(content, "base64");
      const iv = blob.subarray(0, 16);
      const cipher = blob.subarray(16);
      const d = createDecipheriv("aes-128-cbc", Buffer.from(AES_KEY, "utf8"), iv);
      const plain = Buffer.concat([d.update(cipher), d.final()]).toString("utf8");
      console.log("AES DECRYPT OK len=", plain.length, "| head 300:", plain.slice(0, 300));
    } catch (e) {
      console.log("content parse/decrypt ERR:", String(e).slice(0, 200));
    }
  }
}

export {};
