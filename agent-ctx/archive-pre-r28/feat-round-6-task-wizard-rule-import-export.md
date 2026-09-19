---
Task ID: feat-round-6
Agent: Task wizard + rule import/export + style polish
Task: Multi-step task creation wizard + rule JSON import/export + rule duplication enhancement + step indicator style

Work Log:
- Read worklog (prior rounds 1-5: security hardening, 50 bug fixes, crawler enhancement, reader features, dashboard viz, visual rule debugger, bookshelf, search suggestions, book detail enhancements). QA baseline: lint 0/0, tsc 0, dev server stable, 3 rules + 0 tasks, login via /api/auth/login with password audit-fix-2025.
- Read existing code: TaskDialog.tsx (571 lines, single-form dialog for create+edit), TasksSection.tsx (uses TaskDialog for both create+edit), RulesSection.tsx (has 复制/编辑/校准/删除 buttons + batch select), helpers.ts (api wrapper + types), /api/admin/rules/route.ts (POST accepts object OR string config), /api/admin/tasks/route.ts (POST creates task), /api/admin/tasks/[id]/control/route.ts (POST action:start). Confirmed POST /api/admin/rules accepts object config (import path) and string config (original copyRule) — both 200 OK.
- Feature A (TaskWizard):
  - Created `src/components/admin/StepIndicator.tsx`: reusable 4-step indicator. Circles (size-8) with connecting lines. Completed = filled emerald-500 + Check icon. Current = border-violet-500 + ring-2 ring-violet-500/40 + violet-300 number. Future = border-zinc-700 + zinc-600 number. Labels text-[10px] below. Mobile: admin-scroll overflow-x-auto + min-w-max so labels don't truncate. Lines color: emerald (completed side) / zinc-800 (future side).
  - Created `src/components/admin/TaskWizard.tsx` (~570 lines, 'use client'): 4-step wizard dialog for CREATE only.
    * Step 1 (选规则): grid of enabled rules (1-col mobile / 2-col sm). Each card = button with name + description (line-clamp-2) + 已启用/已停用 badge. Selected = border-violet-500 bg-violet-950/30 + Check icon badge top-right. Hover = border-violet-600 bg-zinc-900. Empty state: FileText icon + "暂无采集规则" + "前往采集规则页 →" button (calls onNavigateToRules → closes dialog + onNavigate('rules')). Loading state: Loader2 spinner.
    * Step 2 (配范围): task name input (auto-suggests `${rule.name}-单书采集` or `${rule.name}-范围${listStart}-${listEnd}`; tracks nameTouched flag so user edits aren't overwritten). Mode radio (单本/范围) via custom ModeTab buttons. Single mode → bookUrl input (placeholder = book URL example). Range mode → bordered card with listUrl input (placeholder = rule's parsed list.urlTemplate via safeParseRuleConfig), listStart/listEnd number inputs, bookStart/bookEnd number inputs. Hint text: "列表地址支持 {page} 占位符, 将自动翻页采集".
    * Step 3 (调度): 3 preset buttons in grid-cols-3 (慢速=Snail/标准=Gauge/快速=Zap icons). Active preset = bg-violet-600 text-white. Inactive = border-zinc-700 text-zinc-300 hover:bg-zinc-800. Each shows icon + label + hint (e.g. "2-3线程 / 1-2秒"). Thread slider (Slider from shadcn, min=1 max=10 step=1, dual-thumb [threadMin,threadMax]) with live label "X ~ Y 线程". Interval slider (min=100 max=10000 step=100, dual-thumb) with "X ~ Y ms" label. Storage mode radio (数据库/TXT) with trade-off descriptions. Smart toggles (智能分类/智能完结/自动下拉词) in grid-cols-3 with Switch + label + desc. autoRefresh: bordered card with Switch + Info tooltip ("开启后, 任务完成会按下方间隔(分钟)自动触发一次增量续采...") + refreshIntervalMin number input (5-1440 range) when enabled.
    * Step 4 (确认): emerald success banner + Card with dl/dt/dd grid showing 9 summary rows (任务名称/采集规则/采集模式/采集范围/线程数/请求间隔/存储模式/智能选项/自动刷新). Info box explaining "创建并立即启动" vs "创建但不启动". Footer: 取消 / 上一步 / 创建但不启动 (Save icon, outline) / 创建并立即启动 (Play icon, bg-emerald-600).
    * Step validation: step 0 requires ruleId; step 1 requires valid http(s) URL (+ listStart<=listEnd + bookStart<=bookEnd for range); step 2 requires threadMin<=threadMax + intervalMin<=intervalMax + autoRefresh interval in 5-1440. "下一步" disabled until valid.
    * createTask(start): POST /api/admin/tasks with form → if start, POST /api/admin/tasks/{id}/control {action:start} → toast + onSaved() + close. Catches start failure separately (task still created).
  - Modified `src/components/admin/TasksSection.tsx`: added `onNavigate` prop, `wizardOpen` state. "新建任务" button now opens TaskWizard (setWizardOpen true) instead of TaskDialog. TaskDialog kept for edit (setEditing + setDialogOpen). Renders both: `<TaskDialog .../>` (edit) + `<TaskWizard open={wizardOpen} onNavigateToRules={() => onNavigate?.('rules')} .../>`.
  - Modified `src/components/admin/AdminApp.tsx`: `<TasksSection onNavigate={(s) => setSection(s as SectionKey)} />` so wizard's "前往采集规则页" can navigate to rules section.
- Feature B (Rule import/export):
  - Modified `src/components/admin/RulesSection.tsx`:
    * Added imports: useRef, Download/Upload icons, RuleImportItem interface, FLASH_STYLE constant (CSS keyframe heis-rule-flash: violet 35% → transparent over 1.6s).
    * State: fileInputRef, importing, pendingImport, importConfirmOpen, flashId, flashTimerRef.
    * Toolbar: added 导入 button (Upload icon, disabled when importing, triggers fileInputRef.click()) + 导出 button (Download icon, calls exportRules). Kept 刷新/全量校准/新建规则. Hidden `<input type="file" accept=".json" className="hidden">` below toolbar.
    * exportRules(): if batch.selected.size > 0 → export selected rows; else → export all enabled rows. Maps each to `{name, description, config (parsed object, fallback to raw string on parse fail), enabled}`. Filename `heis-rules-YYYYMMDD-HHmm.json`. Creates Blob(application/json) → URL.createObjectURL → temporary `<a download>` → click → revoke. Toast "已导出 N 条规则 → filename". Empty check: errors if no selected + no enabled.
    * onImportFileChange(): reads file.text() → JSON.parse (catch → "JSON 解析失败") → validateImport() → dedupe names (existingNames Set from rows + seen Set; duplicates get " (导入)" suffix, then " (导入2)", etc.). If prepared.length > 5 → setPendingImport + open ConfirmDialog. Else → runImport directly. File size guard 5MB. Clears input.value after pick so same file can be re-picked.
    * validateImport() (module-level pure function): checks Array + non-empty + ≤200 items. Each item must be object with string non-empty name; config must be undefined/null/object/string; enabled defaults true; description defaults ''. Returns `{ok, rules}` or `{ok:false, error}` with specific error message ("第 N 条规则缺少 name 字段...").
    * runImport(): toast.loading("导入中 0/N…") with id. Loops items sequentially: POST /api/admin/rules with each. On success ok++; on failure fail++ + per-rule toast.error. Updates loading toast "导入中 X/N…". Final: toast.success("成功导入 N 条") if fail=0, else toast.warning("导入完成: 成功 X / 失败 Y"). Awaits load() to refresh list.
    * ConfirmDialog for import (>5 rules): title "将导入 N 条规则, 是否继续?", description explains dedupe + partial failure semantics. tone="teal" (non-destructive). loading=importing. onConfirm → setImportConfirmOpen(false) + runImport(pendingImport).
- Feature B3 (Rule duplication enhancement):
  - copyRule() rewritten: captures created.id from POST response → await load() → setFlashId(created.id) → requestAnimationFrame(scrollIntoView smooth block:center via [data-rule-id] selector) → setTimeout clear flashId after 1.8s (clears previous timer first).
  - TableRow: added `data-rule-id={r.id}` attribute + conditional `heis-rule-flash` class when `flashId === r.id`.
  - useEffect cleanup: clears flashTimerRef on unmount.
  - Injected `<style dangerouslySetInnerHTML={{__html: FLASH_STYLE}}>` at top of RulesSection return (keyframe + class definition).
- Style polish:
  - S1 (Step indicator): 4 circles size-8, emerald-500 + Check for completed, violet-500 + ring-2 ring-violet-500/40 for current, zinc-700 for future. Labels text-[10px] (active=violet-300 font-medium, completed=zinc-300, future=zinc-500). Lines h-0.5 (emerald for completed segments, zinc-800 for future). Mobile: admin-scroll overflow-x-auto + min-w-max on ol.
  - S2 (Rule cards in wizard step 1): border + hover:border-violet-600 + hover:bg-zinc-900 + transition. Selected: border-violet-500 bg-violet-950/30 + Check icon top-right badge (bg-violet-500 text-white size-5). Grid 1-col mobile / 2-cols sm. max-h-80 overflow-y-auto for long lists.
  - S3 (Preset buttons in step 3): grid-cols-3 row. Active: bg-violet-600 text-white. Inactive: border-zinc-700 text-zinc-300 hover:bg-zinc-800. Each button: icon (Snail/Gauge/Zap) + label (慢速/标准/快速) + hint text-[10px] (active=violet-100, inactive=zinc-500). aria-pressed for state.
- Constraints honored: only touched allowed files (TaskWizard.tsx + StepIndicator.tsx created; TasksSection.tsx + RulesSection.tsx + AdminApp.tsx + helpers.ts modified — helpers.ts not actually needed since types defined locally). No /api/* changes (used existing POST /api/admin/rules + POST /api/admin/tasks + POST /api/admin/tasks/[id]/control). No /lib/crawl/* /public/* /prisma/* /mini-services/* changes. All new components 'use client'. Reused shadcn Dialog/Button/Input/Slider/Switch/RadioGroup/Label/Card/Badge/Tooltip + lucide icons (Check/ChevronLeft/ChevronRight/FileText/Info/Loader2/Play/Save/Snail/Gauge/Zap/Upload/Download/Copy).

Test results:
- `bun run lint` → 0 errors / 0 warnings.
- `bunx tsc --noEmit 2>&1 | grep -v "examples\|skills" | wc -l` → 0.
- Dev server: `GET /?admin=1` 200, `GET /` 200.
- API smoke (python urllib): POST /api/admin/rules with object config → 200 (created + deleted). POST /api/admin/rules with string config → 200. POST /api/admin/tasks → 200. POST /api/admin/tasks/{id}/control {action:start} → 200. DELETE → 200.
- agent-browser smoke (single session, closed after):
  * Tasks section: clicked 新建任务 → wizard dialog opens with title "新建采集任务向导" + 4-step indicator + 3 enabled rule cards + 下一步 disabled (no selection).
  * Step 1: clicked XPath规则 card → selected (highlighted) → 下一步 enabled.
  * Step 2: task name auto-filled "XPath结构化站点示例-单书采集" + 单本采集 mode + bookUrl input. 下一步 disabled (empty URL). Filled "https://example.com/book/999.html" → 下一步 enabled.
  * Step 3: 3 preset buttons (慢速/标准/快速) + thread slider [2,3] + interval slider [1000,2000] (标准 defaults) + 数据库/TXT radios + 3 smart toggles (all on) + autoRefresh switch (off) + Info tooltip button. 下一步 enabled.
  * Step 4: summary card shows all 9 rows (任务名称/采集规则/采集模式/采集范围/线程数/请求间隔/存储模式/智能选项/自动刷新) + 创建但不启动 + 创建并立即启动 buttons. Step indicator shows 1✓ 2✓ 3✓ 4(current).
  * Clicked 创建但不启动 → wizard closes → task list shows "XPath结构化站点示例-单书采集 | 单本 | 增量更新 | 数据库 | 2~3线程 | 1000~2000ms | 等待中". Task created successfully.
  * Rules section: 导入 + 导出 buttons present in toolbar (between 搜索框 and 刷新).
  * 导出 (no selection): downloaded `heis-rules-20260906-1321.json` (9539 bytes, 3 rules, config as parsed objects with keys list/book/toc/content/fetch/clean).
  * 导入: uploaded 2-rule JSON file → both rules created → appeared at top of list (sorted by updatedAt desc). Toast "成功导入 2 条规则".
  * 复制 enhancement: clicked 复制 on top row → new row "导入测试规则B (副本)" appeared at top with `heis-rule-flash` class active (verified via eval: `flash=true`) + scrolled into view. Flash cleared after 1.8s.
- Test data cleaned up via API (5 test rules + 1 test task deleted). Final state: 3 rules, 0 tasks (back to baseline).

Stage Summary:
- Files created (2): `src/components/admin/StepIndicator.tsx`, `src/components/admin/TaskWizard.tsx`.
- Files modified (3): `src/components/admin/TasksSection.tsx` (wizard for create + onNavigate prop), `src/components/admin/RulesSection.tsx` (import/export buttons + duplicate scroll/flash + validateImport + runImport + exportRules + ConfirmDialog for >5 imports), `src/components/admin/AdminApp.tsx` (pass onNavigate to TasksSection).
- Features delivered:
  * A: Multi-step task creation wizard (4 steps: 选规则 → 配范围 → 调度 → 确认) replacing single-form TaskDialog for CREATE mode. Edit mode still uses TaskDialog (single form). Step indicator with completed/active/future states. Rule card grid with selection highlight. Auto-suggested task name from rule+mode. Range config with {page} placeholder hint. 3 preset buttons (慢速/标准/快速) that fill dual-thumb sliders. Smart toggles with tooltips. autoRefresh with interval input. Summary card + dual create buttons (创建并立即启动 / 创建但不启动). Empty state with link to rules page.
  * B1: Rule export — 导出 button downloads `heis-rules-YYYYMMDD-HHmm.json`. Exports selected rules (if batch selected) else all enabled. JSON shape: `[{name, description, config (parsed object), enabled}]` excluding id/createdAt/updatedAt. Client-side Blob download.
  * B2: Rule import — 导入 button triggers hidden file input. Reads + parses + validates JSON (array of objects with name/description?/config?/enabled?). Dedupe names with " (导入)" suffix. N>5 triggers ConfirmDialog. Sequential POST with progress toast "导入中 X/N…" → final "成功导入 N 条" or "导入完成: 成功 X / 失败 Y". Per-failure error toasts. File size guard 5MB. Handles invalid JSON / wrong shape / partial failures.
  * B3: Rule duplication enhancement — 复制 captures new rule id, scrolls to new row (smooth, block:center via [data-rule-id] selector), applies `heis-rule-flash` CSS animation (violet 35% → transparent, 1.6s), clears after 1.8s. Timer cleaned up on unmount.
  * S1: Step indicator — 4 circles (size-8) + connecting lines. Completed = emerald-500 + Check. Current = violet-500 + ring-2 ring-violet-500/40. Future = zinc-700. Labels text-[10px]. Mobile horizontal scroll.
  * S2: Rule cards — border + hover:border-violet-600 + hover:bg-zinc-900. Selected = border-violet-500 bg-violet-950/30 + Check badge. Grid 1-col mobile / 2-cols sm.
  * S3: Preset buttons — grid-cols-3. Active = bg-violet-600 text-white. Inactive = border-zinc-700 hover:bg-zinc-800. Icons Snail/Gauge/Zap + label + hint.
- All quality gates green: lint 0/0, tsc 0 errors, dev server / 200 + /?admin=1 200. agent-browser verified full wizard flow (4 steps + create) + export + import + duplicate flash.
