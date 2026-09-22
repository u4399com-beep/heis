// storage.go — 章节 TXT / 封面 webp / 路径穿越防御 + 原子写入 (R38-1C).
//
// 与 TS 端 src/lib/crawl/storage.ts 同口径核心功能:
//   - DATA_ROOT / NOVELS_DIR / COVERS_DIR / DOWNLOADS_DIR (基于 CWD)
//   - EnsureDirs (MkdirAll 三个目录)
//   - SaveChapterTxt (bookId 路径穿越防御 + 标题 slug 清洗 + 原子写入 .tmp+rename)
//   - ReadChapterTxt (sibling-prefix 绕过防御 + path.sep 结尾前缀匹配)
//   - DeleteBookTxt (bookId 路径穿越防御 + 同款清洗)
//   - SaveCoverWebp (封面字节存 .webp; Go 端无 sharp, 直接回存原始字节, 浏览器按魔数嗅探)
//   - ReadCover (sibling-prefix 绕过防御 + path.basename 剥目录组件)
//   - OpenDownloadTxtWriter (流式写入器, 万章书不 OOM)
package crawl

import (
        "context"
        "crypto/rand"
        "encoding/binary"
        "fmt"
        "io"
        "os"
        "path/filepath"
        "regexp"
        "strings"
        "sync"
        "time"
)

var (
        // 数据目录基于 CWD (与 main.go basePath 同口径)
        storageOnce sync.Once
        dataRoot    string
        novelsDir   string
        coversDir   string
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

// DataRoot — 数据根目录绝对路径.
func DataRoot() string {
        initStoragePaths()
        return dataRoot
}

// NovelsDir — 章节TXT存储目录.
func NovelsDir() string {
        initStoragePaths()
        return novelsDir
}

// CoversDir — 封面存储目录.
func CoversDir() string {
        initStoragePaths()
        return coversDir
}

// DownloadsDir — 下载成品存储目录.
func DownloadsDir() string {
        initStoragePaths()
        return downloadsDir
}

// EnsureDirs — 确保数据目录存在.
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

var (
        safeBookIdRe   = regexp.MustCompile(`[\\/\x00\s.]+`)
        trimUnderscore = regexp.MustCompile(`^_+|_+$`)
        chapterSlugRe  = regexp.MustCompile(`[\x00-\x1f\\/:*?"<>|\s]+`)
        coverNameRe    = regexp.MustCompile(`[^\w-]`)
)

// sanitizeBookId — bookId 路径穿越防御: 剥所有路径分隔符与父目录指针字符后 + 去首尾 _.
// 空串兜底 'unknown_book'.
func sanitizeBookId(bookID string) string {
        s := safeBookIdRe.ReplaceAllString(bookID, "_")
        s = trimUnderscore.ReplaceAllString(s, "")
        if s == "" {
                return "unknown_book"
        }
        return s
}

// sanitizeChapterSlug — 章节标题 slug 清洗: 控制字符 + Windows 保留字符 + 空白 → _.
// 按码点截断防代理对斩半 (Bug 21 修复).
func sanitizeChapterSlug(title string, maxRunes int) string {
        if maxRunes <= 0 {
                maxRunes = 80
        }
        cleaned := chapterSlugRe.ReplaceAllString(title, "_")
        runes := []rune(cleaned)
        if len(runes) > maxRunes {
                runes = runes[:maxRunes]
        }
        return string(runes)
}

// sanitizeCoverName — 封面文件名清洗: 仅保留字母数字和 -.
func sanitizeCoverName(name string) string {
        cleaned := coverNameRe.ReplaceAllString(name, "")
        return cleaned
}

// ---------- SaveChapterTxt ----------

// SaveChapterTxt — 章节txt存储: data/novels/{bookId}/{idx pad5}_{slug}.txt
//  - bookId 路径穿越防御 (剥路径分隔符 + 父目录指针字符)
//  - 标题 slug 清洗 (控制字符 + Windows 保留字符 + 按码点截断)
//  - 标题强制单行 (剥 \r\n → 单空格, 防 readChapterTxt.split('\n').slice(1) 误把标题尾行当正文首段)
//  - 原子写入: 先写 .tmp + os.Rename (POSIX 同文件系统原子 inode 替换)
//  - 临时文件名加 PID + 随机段防并发同章节写入互踩
//  返回相对 data/ 的路径 (供 DB 存储 + 公共 read API 使用).
func SaveChapterTxt(bookID string, idx int, title, content string) (string, error) {
        if err := EnsureDirs(); err != nil {
                return "", err
        }
        safeBookID := sanitizeBookId(bookID)
        dir := filepath.Join(novelsDir, safeBookID)
        if err := os.MkdirAll(dir, 0755); err != nil {
                return "", err
        }
        slug := sanitizeChapterSlug(title, 80)
        if slug == "" {
                slug = "chapter"
        }
        slugSafe := sanitizeChapterSlug(slug, 40)
        if slugSafe == "" {
                slugSafe = "chapter"
        }
        fileName := fmt.Sprintf("%05d_%s.txt", idx, slugSafe)
        filePath := filepath.Join(dir, fileName)
        // 标题强制单行 (源站标题偶含 \r\n, 落盘前剥成单行)
        safeTitle := strings.ReplaceAll(title, "\r", " ")
        safeTitle = strings.ReplaceAll(safeTitle, "\n", " ")
        body := safeTitle + "\n\n" + content + "\n"
        // 临时文件名: PID + 随机段
        var randBuf [8]byte
        _, _ = rand.Read(randBuf[:])
        randNum := binary.LittleEndian.Uint64(randBuf[:])
        tmpPath := fmt.Sprintf("%s.%d.%d.tmp", filePath, os.Getpid(), randNum)
        if err := os.WriteFile(tmpPath, []byte(body), 0644); err != nil {
                _ = os.Remove(tmpPath)
                return "", err
        }
        if err := os.Rename(tmpPath, filePath); err != nil {
                _ = os.Remove(tmpPath)
                return "", err
        }
        // 相对 data/ 的路径
        rel, err := filepath.Rel(dataRoot, filePath)
        if err != nil {
                return "", err
        }
        // 统一为 unix 风格 (DB 存储口径)
        rel = filepath.ToSlash(rel)
        return rel, nil
}

// ---------- ReadChapterTxt ----------

// ReadChapterTxt — 读取章节TXT (相对 data/ 的路径).
//  - 路径穿越防御: 必须 === DATA_ROOT 或以 DATA_ROOT + sep 开头
//    (防 sibling-prefix 绕过: data vs data-covers)
//  - 不存在/越界 → 返回 ("", nil)
func ReadChapterTxt(relPath string) (string, error) {
        initStoragePaths()
        // filepath.Join 已 Clean (剥 ..), 但仍需 sibling-prefix 防御: 直接拼 + 前缀校验
        full := filepath.Join(dataRoot, filepath.Clean(filepath.ToSlash(relPath)))
        if full == dataRoot {
                return "", nil
        }
        if !strings.HasPrefix(full, dataRoot+string(filepath.Separator)) {
                return "", nil
        }
        data, err := os.ReadFile(full)
        if err != nil {
                if os.IsNotExist(err) {
                        return "", nil
                }
                return "", err
        }
        return string(data), nil
}

// ---------- DeleteBookTxt ----------

// DeleteBookTxt — 删除整本书的 TXT 目录 (bookId 路径穿越防御).
//  - 与 SaveChapterTxt 同款清洗后再拼路径, 防 caller 误传 '../../etc' 等恶意 ID.
func DeleteBookTxt(bookID string) error {
        safeBookID := sanitizeBookId(bookID)
        dir := filepath.Join(novelsDir, safeBookID)
        return os.RemoveAll(dir)
}

// ---------- SaveCoverWebp ----------

// SaveCoverWebp — 封面字节存 .webp. Go 端无 sharp 库, 直接回存原始字节.
//  - 公开封面接口按 .webp 文件名提供服务, 浏览器 <img> 解码时按魔数嗅探实际格式,
//    不影响展示 (与 TS 端 saveCoverWebp 降级2 回存原始字节同口径)
//  - 空文件/超大文件保护 (>20MB 拒绝)
//  - 文件名: 仅保留 [\w-] 字符, 空串兜底 cover_{ts}_{rand}
//  返回相对 data/ 的路径 (covers/{name}.webp)
func SaveCoverWebp(buf []byte, name string) (string, error) {
        if len(buf) == 0 || len(buf) > 20*1024*1024 {
                return "", nil
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
        if err := os.WriteFile(filePath, buf, 0644); err != nil {
                return "", err
        }
        return "covers/" + fileName, nil
}

// ---------- ReadCover ----------

// ReadCover — 读取封面文件.
//  - path.basename 剥目录组件 + sibling-prefix 绕过防御 (与 ReadChapterTxt 同口径)
//  - 必须 === COVERS_DIR 或以 COVERS_DIR + sep 开头
func ReadCover(fileName string) ([]byte, error) {
        initStoragePaths()
        safe := filepath.Base(fileName)
        full := filepath.Join(coversDir, safe)
        if full != coversDir && !strings.HasPrefix(full, coversDir+string(filepath.Separator)) {
                return nil, nil
        }
        data, err := os.ReadFile(full)
        if err != nil {
                if os.IsNotExist(err) {
                        return nil, nil
                }
                return nil, err
        }
        return data, nil
}

// ---------- DownloadTxtWriter ----------

// DownloadTxtWriter — 流式写入器 (万章书不 OOM).
//  - Open: 打开 filePath ('w' 模式, 截断)
//  - Write: 逐段 append
//  - Finish: close + stat, 返回 {rel, size}
//  - Abort: close + 删除半成品 (失败即无文件卫生语义)
type DownloadTxtWriter interface {
        Rel() string
        Write(ctx context.Context, chunk string) error
        Finish(ctx context.Context) (rel string, size int64, err error)
        Abort(ctx context.Context) error
}

type downloadTxtWriter struct {
        file     *os.File
        filePath string
        rel      string
}

// downloadTxtTarget — 下载成品文件名计算 (清洗控制字符 + 按码点截断防超长).
func downloadTxtTarget(name string) (filePath, rel, fileName string) {
        cleaned := chapterSlugRe.ReplaceAllString(name, "_")
        runes := []rune(cleaned)
        if len(runes) > 100 {
                runes = runes[:100]
        }
        base := string(runes)
        runes2 := []rune(base)
        if len(runes2) > 80 {
                runes2 = runes2[:80]
        }
        fileName = string(runes2) + ".txt"
        filePath = filepath.Join(downloadsDir, fileName)
        rel = "downloads/" + fileName
        return
}

// OpenDownloadTxtWriter — 打开下载成品流式写入器.
func OpenDownloadTxtWriter(name string) (DownloadTxtWriter, error) {
        if err := EnsureDirs(); err != nil {
                return nil, err
        }
        fp, rel, _ := downloadTxtTarget(name)
        f, err := os.OpenFile(fp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
        if err != nil {
                return nil, err
        }
        return &downloadTxtWriter{file: f, filePath: fp, rel: rel}, nil
}

func (w *downloadTxtWriter) Rel() string { return w.rel }

func (w *downloadTxtWriter) Write(ctx context.Context, chunk string) error {
        if chunk == "" {
                return nil
        }
        // ctx 取消检查 (写盘是阻塞 IO, 写入前检查)
        select {
        case <-ctx.Done():
                return ctx.Err()
        default:
        }
        _, err := io.WriteString(w.file, chunk)
        return err
}

func (w *downloadTxtWriter) Finish(ctx context.Context) (string, int64, error) {
        if err := w.file.Close(); err != nil {
                return "", 0, err
        }
        info, err := os.Stat(w.filePath)
        if err != nil {
                return "", 0, err
        }
        return w.rel, info.Size(), nil
}

func (w *downloadTxtWriter) Abort(ctx context.Context) error {
        if err := w.file.Close(); err != nil && !os.IsExist(err) {
                // ignore 已关闭
        }
        return os.Remove(w.filePath)
}
