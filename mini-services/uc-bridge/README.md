# uc-bridge (agent-JJ-turnstile)

5 级 CF Turnstile 反反爬策略链的 **L2 / L3 级** —— Python `undetected-chromedriver`
+ `pyvirtualdisplay`(xvfb)。本桥承担 "UC 浏览器实例的拉起与目标 URL 渲染",
与引擎既有 CloakBrowser(`src/lib/crawl/obscura.ts`, L4) 能力互补。

## 端口

`127.0.0.1:3016`(仅本地, 不对局域网暴露)

## 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/health` | 健康探针(免鉴权/免限速), 返回 `{ ok, selfTestOk, versions, chromePath, xvfbAvailable }` |
| GET  | `/metrics` | Prometheus 文本 0.0.4 格式(鉴权闸, 免限速) |
| GET  | `/info` | 版本/uptime/配置(脱敏)/依赖(鉴权闸, 免限速) |
| POST | `/fetch` | `{ url, cookies?, timeout?, xvfb? }` → `{ ok, status, html, cookies, finalUrl, xvfbUsed }` |
| POST | `/solve-turnstile` | `{ url, timeout?, xvfb? }` → `{ ok, solved, cookies, html, finalUrl, xvfbUsed }` |

`?xvfb=1` 查询参数强制启用虚拟帧缓冲(L3 级); 不传则按 `DISPLAY` 环境变量决定
(有 `DISPLAY` 走 L2, 无则自动走 L3)。

## 安装

### 1. Python 依赖

```bash
cd mini-services/uc-bridge
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

或全局安装到当前 Python 环境(本项目已用 `/home/z/.venv`):

```bash
/home/z/.venv/bin/pip install -r requirements.txt
```

### 2. Chrome 安装

UC 需要 Chrome stable(或 Chrome for Testing / Playwright Chromium)。

**选项 A — 使用 Playwright 已装的 Chromium(本项目已含):**

```bash
# Playwright Chromium 已自动装在 ~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome
# uc-bridge 启动时会自动探测此路径, 无需额外配置
ls ~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome
```

**选项 B — apt 安装系统 Chrome(生产服务器推荐):**

```bash
# Debian/Ubuntu
sudo apt install -y chromium-browser
# 或 google-chrome-stable
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update && sudo apt install -y google-chrome-stable
```

**选项 C — 显式指定 Chrome 路径:**

```bash
export UC_CHROME_PATH=/path/to/chrome
```

uc-bridge 启动时 `/health.chromePath` 字段会暴露实际使用的 Chrome 路径。

### 3. xvfb(可选, L3 级必需)

```bash
# Debian/Ubuntu
sudo apt install -y xvfb
# 验证
which xvfb-run
```

如已 `pip install pyvirtualdisplay`, uc-bridge 会自动用它包装 Xvfb 子进程
(无需 `xvfb-run` CLI, 但仍需 `xvfb` 包提供 `Xvfb` 二进制)。

## 运行

```bash
# 通过 mini-services/start-all.sh 统一拉起(已纳入, 端口 3016)
cd /home/z/my-project && bash mini-services/start-all.sh

# 或单独启动
cd mini-services/uc-bridge
bun run dev    # 等价 .venv/bin/python server.py
# 或直接
python3 server.py
```

## 鉴权 / 限速 / SSRF

与 `scrapling-bridge` 同口径:

- 鉴权: `AUTH_TOKEN`(优先)或 `BRIDGE_KEY`(别名); 任一非空时, 非 `/health`
  请求必须带 `X-Auth-Token` / `X-Bridge-Key` / `Authorization: Bearer` 之一
  (常量时间比较, 失败 401)。
- 限速: 每 IP 60 req/min(`RATE_LIMIT_PER_MIN` 可调); 超限 429 + `Retry-After`。
- SSRF: 拒绝 localhost / 私网 / 链路本地 / 元数据端点
  (`BRIDGE_SSRF_ALLOW_LOOPBACK=1` 放行回环测试场景)。
- 安全头: 所有响应(含 `/health` / 4xx / 5xx)统一附
  `X-Content-Type-Options:nosniff` / `X-Frame-Options:DENY` / `Referrer-Policy:no-referrer`。
- 超时: 30s 请求总时长硬帽(任务要求); 超时 504。
- 浏览器并发闸: `BROWSER_CONCURRENCY=2`(UC 启动慢 + 内存大, 严于 scrapling-bridge 的 3)。

## 引擎集成

在 `src/lib/crawl/types.ts` 的 `FetchConfig` 中启用:

```ts
{
  turnstileBypass: true,             // 启用 5 级链
  turnstileBypassLevel: 5,            // 默认 5(全链兜底); 1=只试 L1, 4=跳过 L5
  ucBridgeUrl: 'http://127.0.0.1:3016'  // 缺省值, 可省略
}
```

调用流程详见 `src/lib/crawl/obscura.ts:bypassTurnstile()` 与
`src/lib/crawl/fetcher.ts:fetchPageOnce()` 中 `captchaType === 'turnstile'` 分支。

## 5 级策略链(本桥承担 L2/L3)

| 级别 | 引擎 | 实现位置 | 备注 |
|------|------|----------|------|
| L1 | Cookie 重放 | `fetcher.fetchHttpWithCurlFallback` | 用 cookieJar 既有 cf_clearance 直连, 最便宜 |
| **L2** | **undetected-chromedriver** | **本桥 `/fetch`** | UC patch Chromium, 规避 CDP 检测 |
| **L3** | **xvfb + UC** | **本桥 `/fetch?xvfb=1`** | 无 DISPLAY 服务器场景; pyvirtualdisplay 包装 Xvfb |
| L4 | CloakBrowser | `obscura.ts` 既有 `withObscuraPage + tryClickTurnstile` | 本项目自研隐身 Playwright |
| L5 | 裸 Playwright | `obscura.ts` 裸 `chromium.launch()` | 最后兜底, 大概率被识别但至少渲染 JS |

任一级成功即返回该级 `html + cookies + engine` 标识; 全部失败才落回原
`captchaCooldown` 冷却期逻辑。
