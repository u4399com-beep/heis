/** qq-d: 七猫 content 解码深探 — 区分出版书/网文书 content 形态, 验证 AES chapter 文本 */
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
  return { status: res.status, j: await res.json().catch(() => null) };
}

// 搜索一批书, 找非出版(source 空/七猫)的网文
const s1 = await getJSON(`https://api-bc.wtzw.com/search/v1/words?${ue({ gender: "3", imei_ip: "2937357107", page: 1, wd: "我在精神病院学斩神", sign: signP({ gender: "3", imei_ip: "2937357107", page: 1, wd: "我在精神病院学斩神" }) })}`);
const books = s1.j?.data?.books || [];
console.log("search:", books.length, "books");
for (const b of books.slice(0, 3)) console.log(" -", b.id, b.original_title, "| author:", b.original_author, "| source:", b.source || "(null)");

const book = books[0];
if (!book) { console.log("no book"); process.exit(0); }
const bid = String(book.id);
console.log("== pick bid:", bid, book.original_title);

const t1 = await getJSON(`https://api-ks.wtzw.com/api/v1/chapter/chapter-list?${ue({ id: bid, sign: signP({ id: bid }) })}`);
const list = t1.j?.data?.chapter_lists || [];
console.log("toc:", list.length, "chapters | ch1:", JSON.stringify(list[0]));

for (const idx of [0, 1]) {
  const ch = list[idx];
  if (!ch) break;
  const cid = String(ch.id);
  const c1 = await getJSON(`https://api-ks.wtzw.com/api/v1/chapter/content?${ue({ id: bid, chapterId: cid, sign: signP({ id: bid, chapterId: cid }) })}`);
  const content = c1.j?.data?.content || "";
  console.log(`\n-- ch[${cid}] ${ch.title} status=${c1.status} contentLen=${content.length}`);
  const blob = Buffer.from(content, "base64");
  console.log("   blob len:", blob.length, "| first 24 bytes hex:", blob.subarray(0, 24).toString("hex"), "| ascii head:", JSON.stringify(blob.subarray(0, 20).toString("latin1")));
  try {
    const d = createDecipheriv("aes-128-cbc", Buffer.from(AES_KEY, "utf8"), blob.subarray(0, 16));
    const plain = Buffer.concat([d.update(blob.subarray(16)), d.final()]).toString("utf8");
    const isZip = plain.slice(0, 2) === "PK";
    console.log("   AES decrypt:", isZip ? "ZIP/EPUB!" : "TEXT", "len:", plain.length, "| head:", JSON.stringify(plain.slice(0, 150)));
  } catch (e) {
    console.log("   AES decrypt ERR:", String(e).slice(0, 120));
  }
}

export {};
