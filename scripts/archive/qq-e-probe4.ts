// qq-e 探针4: obscura 纯函数+脚本编译性侦察
import { parseUaIdentity, buildIdentityInitScript, STEALTH_INIT_SCRIPTS, looksLikeChallenge, isJsRedirectShell, randomFingerprint } from '../src/lib/crawl/obscura'

console.log('--- O1: 三段安卓 UA 机型解析(ii-c 修复回归) ---')
const ua3 = 'Mozilla/5.0 (Linux; U; Android 13; zh-cn; M2102J2SC Build/TKQ1.220829.002) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/137.0.0.0 Mobile Safari/537.36'
console.log('model =', JSON.stringify(parseUaIdentity(ua3).model), 'chPlatform =', parseUaIdentity(ua3).chPlatform)
const ua2 = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'
console.log('model =', JSON.stringify(parseUaIdentity(ua2).model), 'brands =', JSON.stringify(parseUaIdentity(ua2).brands))

console.log('--- O2: 注入脚本编译性(语法损坏=静默全灭面) ---')
let bad = 0
try { new Function(buildIdentityInitScript(ua3)); console.log('identity script 编译 OK') } catch (e: any) { bad++; console.log('identity 编译失败:', e?.message) }
STEALTH_INIT_SCRIPTS.forEach((s, i) => {
  try { new Function(s); console.log(`stealth[${i}] 编译 OK`) } catch (e: any) { bad++; console.log(`stealth[${i}] 编译失败:`, e?.message) }
})

console.log('--- O3: UA覆盖指纹一致性 ---')
const fp = randomFingerprint({ userAgent: ua2 })
console.log('mobile =', fp.mobile, 'hasTouch =', fp.mobile, 'viewport =', JSON.stringify(fp.viewport))
const fpD = randomFingerprint({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36' })
console.log('desktop mobile =', fpD.mobile, 'gpu.os =', parseUaIdentity(fpD.userAgent).os)

console.log('--- O4: 挑战判定边界 ---')
console.log('空串 →', looksLikeChallenge(''), '(期望 true)')
console.log('正常短章节 →', looksLikeChallenge('<html><head><title>第1章 试炼</title></head><body><p>他输入了验证码, 门开了。</p></body></html>'), '(期望 false: 长度<1200 且软词命中... 现状?)')
console.log('JS跳转壳 →', isJsRedirectShell('<script>location.href="/x"</script>'), '(期望 true)')
console.log('长正文含"验证码" →', looksLikeChallenge('<html><head><title>第2章 攻防</title></head><body>' + '<p>剧情推进, 验证码攻防情节。</p>'.repeat(80) + '</body></html>'), '(期望 false)')
process.exit(0)
