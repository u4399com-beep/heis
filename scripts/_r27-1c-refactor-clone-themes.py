#!/usr/bin/env python3
"""
R27-1C: 自动重构 clone-themes 文件 — 替换重复的 goHome/goSearch handler 块为
cloneNavHandlers 调用。安全策略: 只替换完全匹配的连续 handler 块, 不做边界扩展,
不动 goCat (除非它紧贴在 goHome/goSearch 中间且本身是标准模式)。
"""
import re
from pathlib import Path

THEME_INPUT_NAME = {
    '23qb': 'searchkey', '101kks': 'searchkey', 'aijjxs': 'keyboard',
    'ddyueshu': 'searchkey', 'ggd66': 'searchkey', 'huangjinwu': 'keyword',
    'pilishuwu': 'key', 'shipsay': 'searchkey', 'trxsw': 'q', 'x2552': 'searchkey',
}

# 整块匹配 (顺序: goCat? + goHome + goSearch, 全部紧贴在一起, 中间最多 1 个空行)
# goCat 标准 + goHome 多行 + goSearch 多行
BLOCK_GOCAT_GOHOME_GOSEARCH = re.compile(
    r"const goCat = \(e: React\.MouseEvent(?:, catId\?: string)?\) => \{\s*\n"
    r"\s*e\.preventDefault\(\)\s*\n"
    r"\s*navigate\(\{ view: 'category', cat: catId \}\)\s*\n"
    r"\s*\}\s*\n"
    r"\s*const goHome = \(e: React\.MouseEvent\) => \{\s*\n"
    r"\s*e\.preventDefault\(\)\s*\n"
    r"\s*navigate\(\{ view: 'home' \}\)\s*\n"
    r"\s*\}\s*\n"
    r"\s*const goSearch = \(e: React\.FormEvent<HTMLFormElement>\) => \{\s*\n"
    r"\s*e\.preventDefault\(\)\s*\n"
    r"\s*const \w+ = \(e\.currentTarget\.elements\.namedItem\('[^']+'\) as HTMLInputElement\)\?\.value\?\.trim\(\)\s*\n"
    r"\s*if \(\w+\) navigate\(\{ view: 'search'(?:, q: \w+|, q) \}\)\s*\n"
    r"\s*\}",
    re.DOTALL,
)

# goHome 多行 + goSearch 多行 (无 goCat 在中间)
BLOCK_GOHOME_GOSEARCH = re.compile(
    r"const goHome = \(e: React\.MouseEvent\) => \{\s*\n"
    r"\s*e\.preventDefault\(\)\s*\n"
    r"\s*navigate\(\{ view: 'home' \}\)\s*\n"
    r"\s*\}\s*\n"
    r"\s*const goSearch = \(e: React\.FormEvent<HTMLFormElement>\) => \{\s*\n"
    r"\s*e\.preventDefault\(\)\s*\n"
    r"\s*const \w+ = \(e\.currentTarget\.elements\.namedItem\('[^']+'\) as HTMLInputElement\)\?\.value\?\.trim\(\)\s*\n"
    r"\s*if \(\w+\) navigate\(\{ view: 'search'(?:, q: \w+|, q) \}\)\s*\n"
    r"\s*\}",
    re.DOTALL,
)

# 单行 goHome + 多行 goSearch (23qb 风格)
BLOCK_SINGLE_GOHOME_GOSEARCH = re.compile(
    r"const goHome = \(e: React\.MouseEvent\) => \{ e\.preventDefault\(\); navigate\(\{ view: 'home' \}\) \}\s*\n"
    r"\s*const goSearch = \(e: React\.FormEvent<HTMLFormElement>\) => \{\s*\n"
    r"\s*e\.preventDefault\(\)\s*\n"
    r"\s*const \w+ = \(e\.currentTarget\.elements\.namedItem\('[^']+'\) as HTMLInputElement\)\?\.value\?\.trim\(\)\s*\n"
    r"\s*if \(\w+\) navigate\(\{ view: 'search'(?:, q: \w+|, q) \}\)\s*\n"
    r"\s*\}",
    re.DOTALL,
)

# 单行 goCat + 单行 goHome + 多行 goSearch
BLOCK_GOCAT_SINGLE_GOHOME_GOSEARCH = re.compile(
    r"const goCat = \(e: React\.MouseEvent(?:, catId\?: string)?\) => \{ e\.preventDefault\(\); navigate\(\{ view: 'category', cat: catId \}\) \}\s*\n"
    r"\s*const goHome = \(e: React\.MouseEvent\) => \{ e\.preventDefault\(\); navigate\(\{ view: 'home' \}\) \}\s*\n"
    r"\s*const goSearch = \(e: React\.FormEvent<HTMLFormElement>\) => \{\s*\n"
    r"\s*e\.preventDefault\(\)\s*\n"
    r"\s*const \w+ = \(e\.currentTarget\.elements\.namedItem\('[^']+'\) as HTMLInputElement\)\?\.value\?\.trim\(\)\s*\n"
    r"\s*if \(\w+\) navigate\(\{ view: 'search'(?:, q: \w+|, q) \}\)\s*\n"
    r"\s*\}",
    re.DOTALL,
)

# 单行 goCat + 多行 goHome + 多行 goSearch (101kks/HomeClone 风格 — 101kks goCat 单行)
BLOCK_GOCAT_SINGLE_GOHOME_MULTI_GOSEARCH = re.compile(
    r"const goCat = \(e: React\.MouseEvent\) => \{ e\.preventDefault\(\); navigate\(\{ view: 'category' \}\) \}\s*\n"
    r"\s*const goHome = \(e: React\.MouseEvent\) => \{\s*\n"
    r"\s*e\.preventDefault\(\)\s*\n"
    r"\s*navigate\(\{ view: 'home' \}\)\s*\n"
    r"\s*\}\s*\n"
    r"\s*const goSearch = \(e: React\.FormEvent<HTMLFormElement>\) => \{\s*\n"
    r"\s*e\.preventDefault\(\)\s*\n"
    r"\s*const \w+ = \(e\.currentTarget\.elements\.namedItem\('[^']+'\) as HTMLInputElement\)\?\.value\?\.trim\(\)\s*\n"
    r"\s*if \(\w+\) navigate\(\{ view: 'search'(?:, q: \w+|, q) \}\)\s*\n"
    r"\s*\}",
    re.DOTALL,
)


def refactor_file(path: Path, input_name: str) -> tuple[bool, str]:
    text = path.read_text(encoding='utf-8')
    original = text

    if 'cloneNavHandlers' in text:
        return False, 'already refactored'

    # 加 import (在 ../shared 的 type import 后)
    type_import_pat = re.compile(
        r"(import type \{ \w+Props \} from '\.\./shared')\n",
    )
    add_import = "import { cloneNavHandlers } from '../shared'"
    if type_import_pat.search(text):
        text = type_import_pat.sub(
            lambda m: m.group(1) + "\n" + add_import + "\n",
            text,
            count=1,
        )
    else:
        return False, 'no type import found'

    # 按从最长到最短顺序尝试匹配 (避免短 pattern 错误匹配)
    patterns = [
        ('goCat+goHome+goSearch', BLOCK_GOCAT_GOHOME_GOSEARCH, True),
        ('goCat_single+goHome+goSearch', BLOCK_GOCAT_SINGLE_GOHOME_GOSEARCH, True),
        ('goCat_single+goHome_single+goSearch', BLOCK_GOCAT_SINGLE_GOHOME_MULTI_GOSEARCH, True),
        ('goHome_single+goSearch', BLOCK_SINGLE_GOHOME_GOSEARCH, False),
        ('goHome+goSearch', BLOCK_GOHOME_GOSEARCH, False),
    ]

    matched = False
    for name, pat, with_gocat in patterns:
        m = pat.search(text)
        if m:
            destructure = "goHome, goSearch, goCat" if with_gocat else "goHome, goSearch"
            replacement = (
                f"// R27-1C: 复用 cloneNavHandlers\n"
                f"  const {{ {destructure} }} = cloneNavHandlers(navigate, '{input_name}')"
            )
            text = text[:m.start()] + replacement + text[m.end():]
            matched = True
            break

    if not matched:
        return False, 'no goHome+goSearch block matched'

    if text != original:
        path.write_text(text, encoding='utf-8')
        return True, f'OK ({name if "name" in dir() else ""})'
    return False, 'no change'


def main():
    base = Path('src/components/public/clone-themes')
    total_modified = 0
    total_skipped = 0
    for theme_dir in sorted(base.iterdir()):
        if not theme_dir.is_dir():
            continue
        theme = theme_dir.name
        if theme not in THEME_INPUT_NAME:
            continue
        input_name = THEME_INPUT_NAME[theme]
        for tsx in sorted(theme_dir.glob('*.tsx')):
            if tsx.name == 'index.ts':
                continue
            modified, reason = refactor_file(tsx, input_name)
            status = 'MODIFIED' if modified else 'SKIP '
            print(f'  [{status}] {tsx.relative_to(base)}: {reason}')
            if modified:
                total_modified += 1
            else:
                total_skipped += 1
    print(f'\nTotal: modified={total_modified}, skipped={total_skipped}')


if __name__ == '__main__':
    main()
