# Task ID: feat-rules-batch
# Agent: Batch crawl rules for 25 sites

## Work Log
- Read worklog.md + 4 reference files (seed-rule-biqugetw.ts, seed-rule-piaotia.ts, src/lib/crawl/types.ts, src/lib/crawl/rule-templates.ts) to internalize FieldRule/PageRule/FetchConfig/CleanConfig shape and the biquge.tw real-world config (og:novel:* meta + lastest 拼写 + .booklist li + #chaptercontent + biquge ad patterns).
- Inspected API auth shape: POST /api/auth/login → Set-Cookie `heis_admin=<jwt>`; rules CRUD at POST /api/admin/rules (withGuard), GET /api/admin/rules?take=500 returns data array; DELETE /api/admin/rules/[id].
- Authored `scripts/seed-rules-batch-v2.ts`:
  - `biqugeRule(domain, opts)` factory generates a complete RuleConfig (list/book/toc/content/fetch/clean) following biquge.tw template — supports custom listPath / itemSelector / contentSelector / tocSelector / engine override + domain-escaped adPattern.
  - 12 笔趣阁系 sites use the factory with per-site customizations (gegedangbook /sort/1/{page}.html; biqu5200+biquge5200 /top/{page}/ + #content + #list dd; libahao2 engine=auto for 403).
  - 12 dedicated configs for non-biquge sites: ttkan (pure-g `.novel_info` + .novel_chapters_item + tocLink "查看全部章节" + `#content, .article-content`), 69shuba (engine=auto, .bookitem, .item, #content/#chaptercontent dual fallback), 8kana (inferred biquge), 101kks (CF, engine=auto), shucong (GBK+403, engine=auto), hetushu (403, auto), guichuideng (/book/{page}.html, .item/.book-item, auto), dongliuxiaoshuo (403, auto), uukanshu (SSL000, auto), xiaoshuodaquan (inferred), laobiao (inferred), jhsssd (mobile, uaMode=mobile + .book-item fallback).
  - ptwxz.com explicitly SKIPPED (redirects to piaotia.com — already seeded via seed-rule-piaotia.ts); logged at startup.
  - Credibility markers in every description: `[实测]` / `[实测403]` / `[实测CF]` / `[实测SSL000]` / `[实测200]` / `[实测403+GBK]` for probed sites; `[推断]` for inferred.
  - All descriptions ≤500 chars (API enforces str(..., 500)).
  - main(): login()→cookie, fetchAllRuleNames()→Map name→ids, per-rule try/catch (delete same-name first, then create), summary `入库 N/24 条` + final hint "规则已入库, 请在后台 采集规则 → 编辑 → 测试面板 逐个验证微调选择器".
- Ran script: ALL 24/24 rules inserted on first run, no failures. Re-ran script to verify idempotency → 24/24 again, total DB count stayed at 27 (3 pre-existing rules + 24 new), zero duplicates.
- Verified via curl + python: GET /api/admin/rules total=27, batch-matched (24) domains all present, zero duplicate names within batch.
- `bun run lint` clean (no errors/warnings).

## Stage Summary
- **Rules created: 24/24** (25 candidate sites, ptwxz.com skipped as piaotia.com redirect duplicate)
- **Sites list (24)**:
  - 笔趣阁系(12): gegedangbook.com, biqu5200.com, biquge5200.com, biqugse.com, xbiqubao.com, ibiquges.com, ibiquwx.com, biquwx.com, duokanbiqu.com, zhongwenzw.com, 123duw.com, libahao2.com
  - ttkan(1): cn.ttkan.co (pure-g dedicated config)
  - CF/挑战(3): 69shuba.com, 8kana.com, 101kks.com
  - GBK/403(1): shucong.com
  - 403站点(3): hetushu.com, guichuideng.info, dongliuxiaoshuo.com
  - 其他(4): uukanshu.com, xiaoshuodaquan.com, laobiao.cc, jhsssd.com (mobile UA)
- **Idempotent**: verified — re-run deletes same-named then recreates, no dups.
- **DB total**: 27 (24 new + 3 pre-existing seed rules).
- **Lint**: clean.
- **NOT done**: live 4-stage tests (deliberately skipped per task spec — too slow for 24 sites with many CF/403; user to verify each rule in admin 采集规则 → 编辑 → 测试面板).
- **Risk notes** (in each rule description): CF/403/SSL sites likely need browser engine or proxy on real采集; inferred biquge selectors may need tuning; jhsssd mobile UA may surface different selectors; ttkan sub-class names (.novel_info_*) inferred and may need probe-based adjustment.
