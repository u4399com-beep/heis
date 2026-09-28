// storage.go — 封面 webp 落盘 + 路径穿越防御 + 原子写入 (R38-1C, R80-C 精简).
//
// 核心功能 (R80-C 精简后):
//   - DATA_ROOT / NOVELS_DIR / COVERS_DIR / DOWNLOADS_DIR (基于 CWD, 由 initStoragePaths
//     统一初始化; fetcher.go 亦依赖 dataRoot 做 .cookies.json / .tls_sessions.json 落盘)
//   - EnsureDirs (MkdirAll 三个目录, 防御性确保存在即使当前仅 covers 写入)
//   - SaveCoverWebp (封面字节存 .webp; Go 端无 sharp, 直接回存原始字节, 浏览器按魔数嗅探)
//
// R80-C 精简 (BUG-169): 删除 0-caller deadcode 8 export + cascade:
//   - SaveChapterTxt / ReadChapterTxt / DeleteBookTxt / ReadCover (TXT 文件存储 API,
//     R38-1C 加后从未被 admin.go / main.go / runner.go / fetcher.go wiring; main.go
//     getReadViewData line 3455 注释 "暂不读 txt 文件 (留给后续)" 即此 4 函数的待
//     wiring 状态). R65-C/R67-C/R75-C/R78-B 多轮决策 KEEP (future wiring 意图),
//     R80-C 任务要求 "0 调用 deadcode 删" + R79 交接 #2 明确深抓+精简, 删除.
//   - DataRoot / NovelsDir / CoversDir / DownloadsDir (exported 路径访问器, 0 caller;
//     fetcher.go 直接读 dataRoot var 不经 DataRoot() accessor; 4 accessor 0 caller).
//   - cascade: bookMutexFor / bookFileMu sync.Map (per-bookID mutex, 仅被
//     SaveChapterTxt/DeleteBookTxt 用) / sanitizeBookId / sanitizeChapterSlug
//     (仅被 SaveChapterTxt/DeleteBookTxt 用) / safeBookIdRe / trimUnderscore /
//     chapterSlugRe (仅被 sanitizeBookId/sanitizeChapterSlug 用).
//   - 不删: initStoragePaths (fetcher.go 调) / dataRoot var (fetcher.go 读) /
//     novelsDir/coversDir/downloadsDir vars (EnsureDirs MkdirAll 用) / EnsureDirs
//     (SaveCoverWebp 调, exported future wiring) / SaveCoverWebp (runner.go 调,
//     真活路径) / sanitizeCoverName / coverNameRe (SaveCoverWebp 用).
//   - 失 BUG 修复价值: SaveChapterTxt/DeleteBookTxt 内 R73-C BUG-104 (per-bookID
//     mutex race fix) + R65-C BUG-43 (fsync crash 安全) + R73-C BUG-106 (slug 二次
//     清洗冗余) + R73-C BUG-107 (initStoragePaths 漏调) + R68-C BUG-75 (ReadCover
//     sibling-prefix 防御) 等修复随函数消亡. 未来若 admin.go 接入 TXT 文件存储
//     路径 (万章书 DB content 膨胀时切文件存储), 重新加时需复刻上述 BUG 修复
//     (per-bookID mutex + atomicWriteFileSync + initStoragePaths 顶部调 + slug 清洗
//   - sibling-prefix 路径防御). 历史 BUG 修复详见 worklog R65-C/R68-C/R73-C/R75-C.
package crawl

import (
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

var (
	// 数据目录基于 CWD (与 main.go basePath 同口径). fetcher.go 亦读 dataRoot 做
	// .cookies.json / .tls_sessions.json 落盘, 故 dataRoot 是 fetcher.go 跨文件
	// 依赖, 不可删.
	storageOnce  sync.Once
	dataRoot     string
	novelsDir    string
	coversDir    string
	downloadsDir string
)

func initStoragePaths() {
	storageOnce.Do(func() {
		cwd, _ := os.Getwd()
		// 找项目根 (go-backend 的上级)
		root := cwd
		if _, err := os.Stat(filepath.Join(cwd, "go-backend")); err == nil {
			root = cwd
		} else if strings.HasSuffix(cwd, "go-backend") {
			root = filepath.Dir(cwd)
		}
		dataRoot = filepath.Join(root, "data")
		novelsDir = filepath.Join(dataRoot, "novels")
		coversDir = filepath.Join(dataRoot, "covers")
		downloadsDir = filepath.Join(dataRoot, "downloads")
	})
}

// EnsureDirs — 确保数据目录存在 (novels/covers/downloads 三个目录 MkdirAll).
//
// 防御性 MkdirAll 三个目录即使当前仅 covers 被写入 (SaveCoverWebp), 保 novels/
// downloads 目录存在避免未来 wiring 时首次写入失败. R80-C 删除 SaveChapterTxt/
// ReadChapterTxt/DeleteBookTxt/ReadCover 后, EnsureDirs 仍是 SaveCoverWebp 内部
// 唯一 caller + exported future wiring API (admin.go 若接入下载/导出功能可调).
func EnsureDirs() error {
	initStoragePaths()
	for _, d := range []string{novelsDir, coversDir, downloadsDir} {
		if err := os.MkdirAll(d, 0755); err != nil {
			return err
		}
	}
	return nil
}

// ---------- 路径清洗工具 ----------

// coverNameRe — 封面文件名清洗: 仅保留字母数字和 - (与 sanitizeCoverName 配合).
//
// R80-C 精简: safeBookIdRe / trimUnderscore / chapterSlugRe 已随 sanitizeBookId /
//
//	sanitizeChapterSlug / SaveChapterTxt / DeleteBookTxt 一并删除 (cascade deadcode).
//	仅保留 coverNameRe (供 SaveCoverWebp 内 sanitizeCoverName 用).
var coverNameRe = regexp.MustCompile(`[^\w-]`)

// sanitizeCoverName — 封面文件名清洗: 仅保留字母数字和 -.
func sanitizeCoverName(name string) string {
	cleaned := coverNameRe.ReplaceAllString(name, "")
	return cleaned
}

// ---------- SaveCoverWebp ----------

// SaveCoverWebp — 封面字节存 .webp. Go 端无 sharp 库, 直接回存原始字节.
//   - 公开封面接口按 .webp 文件名提供服务, 浏览器 <img> 解码时按魔数嗅探实际格式,
//     不影响展示 (与 saveCoverWebp 降级2 回存原始字节同口径)
//   - 空文件 (len==0): 返 ("", nil) (caller 跳过 UpdateBookCover, 视为无封面)
//   - 超大文件 (>20MB): 返 ("", err) (拒绝, 防 OOM 写盘; docstring "拒绝" 语义对齐)
//   - 文件名: 仅保留 [\w-] 字符, 空串兜底 cover_{ts}_{rand}
//     返回相对 data/ 的路径 (covers/{name}.webp)
//
// R65-C BUG-44 (P3) 修复: 原用 os.WriteFile 直接写最终路径 (无 .tmp+rename, 无 fsync).
//
//	① crash 在 WriteFile 中途 → 文件部分字节 (破损 .webp, 浏览器 <img> 解码失败);
//	② 并发同 name (e.g. 两本书 cover URL 相同 → sanitizeCoverName 同结果) → 交错写,
//	   最终文件混合两本书字节 (无法预测). 修复: 改用 atomicWriteFileSync (含 fsync)
//	+ .tmp + rename 模式 (与原 SaveChapterTxt 同款, R80-C 已删). fileName 已含 random
//	suffix 时无并发冲突, 但 crash 中途写仍可能留半成品, atomicWriteFileSync + rename
//	保证 "要么完整要么不存在" 语义.
//
// R92-B BUG-256 (P3) 修复: 原条件 `len(buf) == 0 || len(buf) > 20*1024*1024` 合并
//
//	返 ("", nil) — 空文件 (expected skip) vs 超大文件 (reject) 行为混淆, caller
//	无法区分 "无封面 (0 字节)" 与 "被拒绝 (>20MB OOM 风险)", docstring "拒绝"
//	语义 vs 实际返 nil 不符 (exported API 可被未来 caller 误用). 修复: 分离两
//	case — 空文件返 ("", nil) (caller 跳过), 超大文件返 ("", err) (caller 可
//	log/上报). 当前唯一 caller runner.go line 2085 用 `err == nil && rel != ""`
//	两 case 均跳过 (行为不变), 但 API 契约正确. latent 自 R38-1C (47 轮未发现因
//	唯一 caller 不 log err; 未来 caller 加 err log 后受益).
func SaveCoverWebp(buf []byte, name string) (string, error) {
	if len(buf) == 0 {
		return "", nil
	}
	if len(buf) > 20*1024*1024 {
		return "", fmt.Errorf("cover bytes exceed 20MB cap: %d", len(buf))
	}
	if err := EnsureDirs(); err != nil {
		return "", err
	}
	safeName := sanitizeCoverName(name)
	if safeName == "" {
		var randBuf [4]byte
		_, _ = rand.Read(randBuf[:])
		randNum := binary.LittleEndian.Uint32(randBuf[:])
		safeName = fmt.Sprintf("cover_%d_%d", time.Now().UnixMilli(), randNum)
	}
	fileName := safeName + ".webp"
	filePath := filepath.Join(coversDir, fileName)
	// R65-C BUG-44: 临时文件 + atomicWriteFileSync + rename (crash 安全)
	var randBuf [8]byte
	_, _ = rand.Read(randBuf[:])
	randNum := binary.LittleEndian.Uint64(randBuf[:])
	tmpPath := fmt.Sprintf("%s.%d.%d.tmp", filePath, os.Getpid(), randNum)
	if err := atomicWriteFileSync(tmpPath, buf, 0644); err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}
	if err := os.Rename(tmpPath, filePath); err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}
	return "covers/" + fileName, nil
}

// ---------- R80-C 删除的 storage API (历史 BUG 修复痕迹, 留供未来复刻参考) ----------
//
// R80-C BUG-169 (P3) deadcode cascade 删除: 以下 8 export + 7 helper 已删 (0 caller):
//   1. SaveChapterTxt (bookID 路径穿越防御 + 标题 slug 清洗 + 原子写入 .tmp+rename)
//      内嵌 BUG 修复: R65-C BUG-43 (atomicWriteFileSync fsync crash 安全) +
//      R73-C BUG-104 (per-bookID *sync.Mutex bookFileMu 防 Save vs Delete race) +
//      R73-C BUG-106 (slug 二次清洗冗余内联 []rune 截断)
//   2. ReadChapterTxt (sibling-prefix 绕过防御 + path.sep 结尾前缀匹配)
//   3. DeleteBookTxt (bookId 路径穿越防御 + 同款清洗 + per-bookID mutex 串行化)
//      内嵌 BUG 修复: R73-C BUG-107 (顶部漏调 initStoragePaths 孤儿 txt 累积)
//   4. ReadCover (path.basename 剥目录 + sibling-prefix 绕过防御)
//      内嵌 BUG 修复: R68-C BUG-75 (|| vs && 组合, full==coversDir 早返)
//   5. DataRoot / NovelsDir / CoversDir / DownloadsDir (exported 路径访问器)
//   6. bookMutexFor (per-bookID *sync.Mutex 取/创建, sync.Map LoadOrStore 双检查)
//   7. bookFileMu sync.Map (per-bookID mutex 容器)
//   8. sanitizeBookId (bookId 路径穿越防御: 剥路径分隔符 + 父目录指针字符)
//   9. sanitizeChapterSlug (章节标题 slug 清洗: 控制字符 + Windows 保留字符 + 空白)
//   10. safeBookIdRe / trimUnderscore / chapterSlugRe (regex var, cascade)
//
// 删除决策依据:
//   - rg 全仓 (admin.go / main.go / fetcher.go / runner.go / smart.go / hostgate.go /
//     cleaner.go / parser.go / sorter.go / types.go) 0 实际调用 (仅注释提及)
//   - go tool nm 验证 binary 已 dead-code-eliminate (链接器已删除, 源码层 redundant)
//   - R65-C/R67-C/R75-C/R78-B 多轮 KEEP 决策依据 "future wiring" 自 R65 起未实现
//     (R76/R77/R78/R79 均未 wire), R80-C 任务要求 "0 调用 deadcode 删" 终止等待
//
// 未来若需 TXT 文件存储路径 (万章书 DB content 膨胀切文件存储), 重新加时需复刻:
//   - SaveChapterTxt: bookMutexFor + sanitizeBookId + sanitizeChapterSlug +
//     atomicWriteFileSync + rename + filepath.Rel (返回相对 data/ 的路径)
//   - ReadChapterTxt: initStoragePaths + sibling-prefix 防御 (full==dataRoot 早返
//     + HasPrefix(dataRoot+sep) 检查 + os.IsNotExist 早返 nil)
//   - DeleteBookTxt: initStoragePaths 顶部调 + per-bookID mutex 与 SaveChapterTxt
//     共享 (防 Save vs Delete race)
//   - ReadCover: filepath.Base + || 组合 sibling-prefix 防御 (与 ReadChapterTxt
//     同口径)
//   - DataRoot/NovelsDir/CoversDir/DownloadsDir: 4 exported accessor (若 admin
//     需暴露路径给 UI/API)
//
// 详见 worklog R65-C (BUG-43/44/45/46/47) + R68-C (BUG-75) + R73-C (BUG-104/106/
// 107/108/109) + R75-C (BUG-128/130/131) + R80-C (BUG-169).

// ---------- DownloadTxtWriter (R75-C BUG-131 已删) ----------
//
// R75-C BUG-131 (P3) deadcode 清理: 删除 OpenDownloadTxtWriter + DownloadTxtWriter
//   接口 + downloadTxtWriter struct + downloadTxtTarget (4 个 export + 4 个 method +
//   1 个 helper). rg 全仓 0 调用 (main.go / admin.go / fetcher.go / runner.go 全 0
//   命中), R38-1C 加后从未 wiring. R65-C BUG-46 / R67-C BUG-57 修复也修在死代码上
//   (BUG-46 精简 downloadTxtTarget 两次 []rune 转换 / BUG-57 加 Finish fsync), 删除
//   后这些修复随函数一起消亡 (与 R73-C BUG-108 bookLastChapters + R74-C BUG-112
//   circuitTrippedAt 同款 cascade deadcode 清理). 未来需 "万章书下载流式写入器"
//   时重新加 ( ~50 行: interface + struct + 4 method + target helper). 一并删除
//   "context" + "io" 两个 import (仅 OpenDownloadTxtWriter/Write/Finish/Abort 用,
//   删除后 storage.go 不再依赖). chapterSlugRe 仍由 sanitizeChapterSlug 使用
//   (SaveChapterTxt 路径), 保留. (R80-C BUG-169 已随 SaveChapterTxt 一并删除
//   chapterSlugRe + sanitizeChapterSlug, 此处 R75-C 注释留作历史 BUG 修复痕迹.)
