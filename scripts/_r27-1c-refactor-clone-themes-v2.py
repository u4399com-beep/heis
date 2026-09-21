#!/usr/bin/env python3
"""
R27-1C v2: 更灵活的重构 — 允许 goHome 和 goSearch 之间有任意其他 handler (goNav, goView 等)
只替换 goHome 和 goSearch 各自的块, 中间保留。
"""
import re
from pathlib import Path

THEME_INPUT_NAME = {
    '23qb': 'searchkey', '101kks': 'searchkey', 'aijjxs': 'keyboard',
    'ddyueshu': 'searchkey', 'ggd66': 'searchkey', 'huangjinwu': 'keyword',
    'pilishuwu': 'key', 'shipsay': 'searchkey', 'trxsw': 'q', 'x2552': 'searchkey',
}

# 单个 goHome 多行块 (替换为空, 后续用 cloneNavHandlers 取出)
GOHOME_MULTI = re.compile(
    r"const goHome = \(e: React\.MouseEvent\) => \{\s*\n"
    r"\s*e\.preventDefault\(\)\s*\n"
    r"\s*navigate\(\{ view: 'home' \}\)\s*\n"
    r"\s*\}\s*\n?\s*",
    re.DOTALL,
)
# 单个 goSearch 多行块
GOSEARCH_MULTI = re.compile(
    r"const goSearch = \(e: React\.FormEvent<HTMLFormElement>\) => \{\s*\n"
    r"\s*e\.preventDefault\(\)\s*\n"
    r"\s*const \w+ = \(e\.currentTarget\.elements\.namedItem\('[^']+'\) as HTMLInputElement\)\?\.value\?\.trim\(\)\s*\n"
    r"\s*if \(\w+\) navigate\(\{ view: 'search'(?:, q: \w+|, q) \}\)\s*\n"
    r"\s*\}\s*\n?\s*",
    re.DOTALL,
)
# 单个 goHome 单行 (23qb 风格)
GOHOME_SINGLE = re.compile(
    r"const goHome = \(e: React\.MouseEvent\) => \{ e\.preventDefault\(\); navigate\(\{ view: 'home' \}\) \}\s*\n?\s*",
)
# 单个 goCat 多行 (用于决定是否能整体替换)
GOCAT_MULTI = re.compile(
    r"const goCat = \(e: React\.MouseEvent(?:, catId\?: string)?\) => \{\s*\n"
    r"\s*e\.preventDefault\(\)\s*\n"
    r"\s*navigate\(\{ view: 'category', cat: catId \}\)\s*\n"
    r"\s*\}\s*\n?\s*",
    re.DOTALL,
)
# 单个 goCat 单行
GOCAT_SINGLE = re.compile(
    r"const goCat = \(e: React\.MouseEvent(?:, catId\?: string)?\) => \{ e\.preventDefault\(\); navigate\(\{ view: 'category', cat: catId \}\) \}\s*\n?\s*",
)


def refactor_file(path: Path, input_name: str) -> tuple[bool, str]:
    text = path.read_text(encoding='utf-8')
    original = text

    if 'cloneNavHandlers' in text:
        return False, 'already refactored'

    # 加 import
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

    # 找三个块的位置 (用于决定是否需要 goCat in destructure)
    gocat_pos = None
    for pat in [GOCAT_MULTI, GOCAT_SINGLE]:
        m = pat.search(text)
        if m:
            gocat_pos = (m.start(), m.end())
            break
    gohome_pos = None
    for pat in [GOHOME_MULTI, GOHOME_SINGLE]:
        m = pat.search(text)
        if m:
            gohome_pos = (m.start(), m.end())
            break
    gosearch_pos = None
    m = GOSEARCH_MULTI.search(text)
    if m:
        gosearch_pos = (m.start(), m.end())

    if not gohome_pos or not gosearch_pos:
        return False, f'missing goHome({bool(gohome_pos)}) or goSearch({bool(gosearch_pos)})'

    # 决定是否在 destructure 中包含 goCat
    # 条件: 有标准 goCat 块, 且该块紧贴 goHome 或 goSearch (前后无其他代码)
    destructure_gocat = False
    if gocat_pos:
        # 检查 goCat 是否紧贴 goHome 之前或之后 (中间最多有空行)
        between_cat_home = text[gocat_pos[1]:gohome_pos[0]] if gocat_pos[1] < gohome_pos[0] else None
        between_home_search = text[gohome_pos[1]:gosearch_pos[0]] if gohome_pos[1] < gosearch_pos[0] else None
        # 简化: 如果 goCat 在 goHome+goSearch 范围附近 (允许中间有 goNav/goView 但不替换它们)
        # 仅当 goCat 紧贴 goHome 之前, 用 destructure_gocat=True
        if between_cat_home is not None and between_cat_home.strip() == '':
            destructure_gocat = True

    destructure = "goHome, goSearch, goCat" if destructure_gocat else "goHome, goSearch"
    replacement = (
        f"// R27-1C: 复用 cloneNavHandlers\n"
        f"  const {{ {destructure} }} = cloneNavHandlers(navigate, '{input_name}')\n  "
    )

    # 删除三个块 (按倒序删除以保持位置有效)
    blocks_to_delete = sorted(
        [b for b in [gocat_pos, gohome_pos, gosearch_pos] if b],
        key=lambda x: x[0],
        reverse=True,
    )
    # 仅删除在 destructure_gocat=True 时才删 goCat
    if destructure_gocat and gocat_pos:
        pass  # 删 goCat
    elif not destructure_gocat and gocat_pos:
        blocks_to_delete = [b for b in blocks_to_delete if b != gocat_pos]

    # 找出最靠前的 block start, 在该位置插入 replacement
    if blocks_to_delete:
        first_start = min(b[0] for b in blocks_to_delete)
    else:
        first_start = gohome_pos[0]

    # 删除所有 blocks_to_delete
    for start, end in blocks_to_delete:
        text = text[:start] + text[end:]

    # 在 first_start 位置插入 replacement (注意位置可能因前面删除而变化)
    # 由于 blocks_to_delete 已按 reverse 排序删除, first_start 仍然有效 (因为更前的位置未动)
    # 但如果 goCat 已删, first_start 仍然是原 goCat 位置 (在 goHome 之前), 仍然有效
    text = text[:first_start] + replacement + text[first_start:]

    if text != original:
        path.write_text(text, encoding='utf-8')
        return True, f'OK (gocat_in_destructure={destructure_gocat})'
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
