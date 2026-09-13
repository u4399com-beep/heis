/**
 * agent-ZZ-verify-all · comprehensive rule audit
 *
 * 1) Test ALL enabled rules via fetchPage + parseList → items count.
 * 2) For 5 randomly selected rules with items > 0, also test parseBook + parseToc + parseContent.
 * 3) Audit cleaning on those 5: <p> tags, ads removal, paragraph normalization, HTML stripped.
 * 4) Output machine-readable JSON report + console summary.
 *
 * Run: bun run scripts/verify-zz-all-rules.ts
 */
import { PrismaClient } from '@prisma/client';
import { fetchPage } from '../src/lib/crawl/fetcher';
import { parseList, parseBook, parseToc, parseContent } from '../src/lib/crawl/parser';
import { cleanContentHtml } from '../src/lib/crawl/cleaner';
import { parseRuleConfig, type RuleConfig } from '../src/lib/crawl/types';
import { extractField, urlVars } from '../src/lib/crawl/parser';
import * as cheerio from 'cheerio';

const prisma = new PrismaClient();

interface ListTest {
  id: string;
  name: string;
  listUrl: string;
  ok: boolean;
  error?: string;
  httpStatus?: number;
  engine?: string;
  items: number;
  blocked?: boolean;
  captcha?: boolean;
}

interface DeepTest {
  id: string;
  name: string;
  listUrl: string;
  listItems: number;
  book?: {
    ok: boolean;
    error?: string;
    name?: string;
    author?: string;
    intro_len?: number;
    cover?: string;
    wordCount?: number;
  };
  toc?: {
    ok: boolean;
    error?: string;
    chapters: number;
    pages: number;
    firstChapterUrl?: string;
  };
  content?: {
    ok: boolean;
    error?: string;
    rawLength: number;
    cleanedLength: number;
    pages: number;
  };
  clean?: {
    hasPTags: boolean;
    pCount: number;
    hasScript: boolean;
    hasStyle: boolean;
    hasIframe: boolean;
    hasEmptyP: boolean;
    adHits: number;
    sample: string;
  };
}

function pickFirstListUrl(rule: RuleConfig): string {
  const t = rule.list.urlTemplate || '';
  if (!t) return '';
  // page 1, default cat=0 (same as runner R7-14)
  return t
    .replace(/\{cat\}/g, '0')
    .replace(/\{offset:(\d+)\}/g, (_, n) => String(0))
    .replace('{page}', '1');
}

function pickBookUrlFromList(items: { fields: Record<string, string> }[]): string | null {
  for (const it of items) {
    const u = it.fields.url || it.fields.bookUrl;
    if (u && /^https?:\/\//.test(u)) return u;
  }
  return null;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const allRules = await prisma.rule.findMany({
    where: { enabled: true },
    select: { id: true, name: true, config: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`[agent-ZZ] enabled rules: ${allRules.length}`);

  const listTests: ListTest[] = [];
  for (let i = 0; i < allRules.length; i++) {
    const r = allRules[i];
    const cfg = parseRuleConfig(r.config);
    const listUrl = pickFirstListUrl(cfg);
    if (!listUrl) {
      listTests.push({
        id: r.id, name: r.name, listUrl: '(none)', ok: false,
        error: 'no list.urlTemplate', items: 0,
      });
      console.log(`[${i + 1}/${allRules.length}] SKIP ${r.name}: no list.urlTemplate`);
      continue;
    }
    process.stdout.write(`[${i + 1}/${allRules.length}] ${r.name} → ${listUrl.slice(0, 80)} ... `);
    try {
      const res = await fetchPage(listUrl, { ...cfg.fetch, timeout: cfg.fetch.timeout ?? 25_000 });
      const blocked = (res as any).blocked || (res as any).captchaDetected;
      if (blocked) {
        listTests.push({
          id: r.id, name: r.name, listUrl, ok: false, items: 0,
          error: 'blocked:' + ((res as any).captchaType || 'unknown'),
          httpStatus: res.status, engine: res.engine, blocked: true,
        });
        console.log(`BLOCKED (${res.engine}, ${res.status})`);
        await sleep(800);
        continue;
      }
      if (!res.html) {
        listTests.push({
          id: r.id, name: r.name, listUrl, ok: false, items: 0,
          error: 'empty html', httpStatus: res.status, engine: res.engine,
        });
        console.log(`EMPTY (${res.engine}, ${res.status})`);
        await sleep(800);
        continue;
      }
      const parsed = parseList(res.html, listUrl, cfg.list, ['url', 'bookUrl']);
      const cnt = parsed.items.length;
      listTests.push({
        id: r.id, name: r.name, listUrl, ok: true, items: cnt,
        httpStatus: res.status, engine: res.engine,
      });
      console.log(`OK ${cnt} items (engine=${res.engine}, status=${res.status})`);
    } catch (e: any) {
      listTests.push({
        id: r.id, name: r.name, listUrl, ok: false, items: 0,
        error: String(e?.message || e).slice(0, 200),
      });
      console.log(`ERR ${String(e?.message || e).slice(0, 120)}`);
    }
    await sleep(500); // gentle on source sites
  }

  // Save partial list report
  const pass = listTests.filter((t) => t.ok && t.items > 0);
  const failZero = listTests.filter((t) => t.ok && t.items === 0);
  const failErr = listTests.filter((t) => !t.ok);
  console.log('\n========== LIST PHASE SUMMARY ==========');
  console.log(`Pass (items>0):  ${pass.length}/${allRules.length}`);
  console.log(`Zero items:       ${failZero.length}`);
  console.log(`Error/blocked:    ${failErr.length}`);
  if (failZero.length) {
    console.log('\n-- Zero items --');
    for (const t of failZero) console.log(`  ${t.name} :: ${t.listUrl}`);
  }
  if (failErr.length) {
    console.log('\n-- Error/blocked --');
    for (const t of failErr) console.log(`  ${t.name} :: ${t.error} :: ${t.listUrl}`);
  }

  // Pick 5 rules with items > 0, diverse coverage:
  // - prefer different domains
  const seenDomains = new Set<string>();
  const picks: ListTest[] = [];
  // Sort by name for deterministic diversity
  const sortedPass = [...pass].sort((a, b) => a.name.localeCompare(b.name));
  // First pass: pick one per unique domain
  for (const t of sortedPass) {
    try {
      const d = new URL(t.listUrl).hostname;
      if (!seenDomains.has(d)) {
        seenDomains.add(d);
        picks.push(t);
      }
    } catch { /* skip */ }
    if (picks.length >= 5) break;
  }
  // Fill up if needed
  for (const t of sortedPass) {
    if (picks.length >= 5) break;
    if (!picks.find((p) => p.id === t.id)) picks.push(t);
  }

  console.log(`\n========== DEEP TEST 5 picks ==========`);
  const deepResults: DeepTest[] = [];
  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i];
    const cfg = parseRuleConfig(allRules.find((r) => r.id === pick.id)!.config);
    console.log(`\n[Deep ${i + 1}/${picks.length}] ${pick.name}`);
    const deep: DeepTest = {
      id: pick.id, name: pick.name, listUrl: pick.listUrl, listItems: pick.items,
    };

    // ---- parseBook ----
    try {
      const res = await fetchPage(pick.listUrl, { ...cfg.fetch, timeout: 25_000 });
      const parsed = parseList(res.html, pick.listUrl, cfg.list, ['url', 'bookUrl']);
      const bookUrl = pickBookUrlFromList(parsed.items);
      if (!bookUrl) {
        deep.book = { ok: false, error: 'no bookUrl in list items' };
      } else {
        const bookRes = await fetchPage(bookUrl, { ...cfg.fetch, timeout: 30_000, referer: pick.listUrl });
        if (!bookRes.html) {
          deep.book = { ok: false, error: `book fetch empty (status=${bookRes.status})` };
        } else {
          const book = parseBook(bookRes.html, bookUrl, cfg.book);
          deep.book = {
            ok: !!book.name,
            name: book.name,
            author: book.author,
            intro_len: book.intro?.length || 0,
            cover: book.cover?.slice(0, 80),
            wordCount: book.wordCount,
          };
          console.log(`  book: name=${book.name?.slice(0, 40)} author=${book.author?.slice(0, 20)} intro=${book.intro?.length || 0}c cover=${book.cover ? 'Y' : 'N'}`);

          // ---- parseToc ----
          // If cfg.toc.tocLink exists, extract toc URL from book page; else use bookUrl as toc
          let tocUrl = bookUrl;
          if (cfg.toc.tocLink?.expression) {
            try {
              const $ = cheerio.load(bookRes.html);
              const link = extractField(bookRes.html, $, null, null, cfg.toc.tocLink, { vars: urlVars(bookUrl) });
              if (link) {
                const abs = link.startsWith('http') ? link : new URL(link, bookUrl).href;
                if (abs && /^https?:\/\//.test(abs) && abs !== bookUrl) tocUrl = abs;
              }
            } catch { /* ignore */ }
          }
          try {
            let tocRes = await fetchPage(tocUrl, { ...cfg.fetch, timeout: 30_000, referer: bookUrl });
            if (!tocRes.html) {
              deep.toc = { ok: false, error: `toc fetch empty (status=${tocRes.status})`, chapters: 0, pages: 0 };
            } else {
              let toc = await parseToc(tocUrl, tocRes.html, cfg.toc, { ...cfg.fetch, timeout: 30_000, referer: bookUrl });
              // AJAX sites: if toc empty, retry with browser engine (same as runner.ts:1336)
              if (toc.items.length < 5 && tocRes.engine !== 'browser') {
                console.log(`  toc: retry with browser engine (http gave ${toc.items.length})`);
                try {
                  const bRes = await fetchPage(tocUrl, { ...cfg.fetch, engine: 'browser', waitMs: Math.max(cfg.fetch.waitMs || 0, 2500), timeout: 30_000, referer: bookUrl });
                  if (bRes.html) {
                    const bToc = await parseToc(tocUrl, bRes.html, cfg.toc, { ...cfg.fetch, timeout: 30_000, referer: bookUrl });
                    if (bToc.items.length > toc.items.length) toc = bToc;
                  }
                } catch { /* ignore */ }
              }
              const firstCh = toc.items[0]?.url;
              deep.toc = {
                ok: toc.items.length > 0,
                chapters: toc.items.length,
                pages: toc.pages,
                firstChapterUrl: firstCh,
              };
              console.log(`  toc: chapters=${toc.items.length} pages=${toc.pages} first=${firstCh?.slice(0, 80)}`);

              // ---- parseContent (first chapter) ----
              if (firstCh) {
                try {
                  const chRes = await fetchPage(firstCh, { ...cfg.fetch, timeout: 30_000, referer: tocUrl });
                  if (!chRes.html) {
                    deep.content = { ok: false, error: `chapter fetch empty (status=${chRes.status})`, rawLength: 0, cleanedLength: 0, pages: 0 };
                  } else {
                    const content = await parseContent(firstCh, chRes.html, cfg.content, { ...cfg.fetch, timeout: 30_000, referer: tocUrl });
                    const rawLen = content.content.length;
                    const cleaned = cleanContentHtml(content.content, cfg.clean);
                    const cleanedLen = cleaned.length;
                    deep.content = { ok: cleanedLen > 0, rawLength: rawLen, cleanedLength: cleanedLen, pages: content.pages };
                    console.log(`  content: raw=${rawLen}c cleaned=${cleanedLen}c pages=${content.pages}`);

                    // ---- cleaning audit ----
                    const hasScript = /<script\b/i.test(cleaned);
                    const hasStyle = /<style\b/i.test(cleaned);
                    const hasIframe = /<iframe\b/i.test(cleaned);
                    const pMatches = cleaned.match(/<p\b[^>]*>/gi) || [];
                    const hasEmptyP = /<p>(?:\s|&nbsp;)*<\/p>/i.test(cleaned);
                    // Run adPatterns on raw to count ad hits (rough indicator)
                    let adHits = 0;
                    if (cfg.clean.adPatterns) {
                      for (const pat of cfg.clean.adPatterns) {
                        try {
                          const re = new RegExp(pat, 'gi');
                          const m = content.content.match(re);
                          if (m) adHits += m.length;
                        } catch { /* bad regex */ }
                      }
                    }
                    deep.clean = {
                      hasPTags: pMatches.length > 0,
                      pCount: pMatches.length,
                      hasScript,
                      hasStyle,
                      hasIframe,
                      hasEmptyP,
                      adHits,
                      sample: cleaned.slice(0, 200).replace(/\s+/g, ' '),
                    };
                    console.log(`  clean: p=${pMatches.length} script=${hasScript} style=${hasStyle} iframe=${hasIframe} emptyP=${hasEmptyP} adHits=${adHits}`);
                    console.log(`  sample: ${deep.clean.sample}`);
                  }
                } catch (e: any) {
                  deep.content = { ok: false, error: String(e?.message || e).slice(0, 200), rawLength: 0, cleanedLength: 0, pages: 0 };
                  console.log(`  content ERR: ${String(e?.message || e).slice(0, 120)}`);
                }
              } else {
                deep.content = { ok: false, error: 'no chapters in toc', rawLength: 0, cleanedLength: 0, pages: 0 };
              }
            }
          } catch (e: any) {
            deep.toc = { ok: false, error: String(e?.message || e).slice(0, 200), chapters: 0, pages: 0 };
            console.log(`  toc ERR: ${String(e?.message || e).slice(0, 120)}`);
          }
        }
      }
    } catch (e: any) {
      deep.book = { ok: false, error: String(e?.message || e).slice(0, 200) };
      console.log(`  book ERR: ${String(e?.message || e).slice(0, 120)}`);
    }

    deepResults.push(deep);
    await sleep(800);
  }

  // Final report save
  const report = {
    timestamp: new Date().toISOString(),
    totalRules: allRules.length,
    listPhase: {
      pass: pass.length,
      zeroItems: failZero.length,
      errorBlocked: failErr.length,
      details: listTests,
    },
    deepPhase: deepResults,
  };
  const fs = await import('node:fs/promises');
  await fs.writeFile('/home/z/my-project/agent-ZZ-report.json', JSON.stringify(report, null, 2));
  console.log('\n[agent-ZZ] report saved → /home/z/my-project/agent-ZZ-report.json');
  console.log(JSON.stringify({
    totalRules: report.totalRules,
    pass: report.listPhase.pass,
    zeroItems: report.listPhase.zeroItems,
    errBlocked: report.listPhase.errorBlocked,
    deep: deepResults.map((d) => ({ name: d.name, book: d.book?.ok, toc: d.toc?.chapters, content: d.content?.cleanedLength, clean: d.clean })),
  }, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('FATAL:', e);
  await prisma.$disconnect();
  process.exit(1);
});
