const t0 = Date.now();
try {
  const res = await fetch("http://www.qiushu.info/t/225637/76636828.html", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36" },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });
  const buf = await res.arrayBuffer();
  console.log("status", res.status, "bytes", buf.byteLength, "ms", Date.now() - t0, "final", res.url);
} catch (e) {
  console.log("FAIL", (e as Error).name, (e as Error).message, "ms", Date.now() - t0);
}
export {};
