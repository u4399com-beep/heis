// R49: bun wrapper auto-restart Go 后端 (platform 只允许 bun 进程)
// bun run dev → bun start-go.js → 持续启动 ./go-backend/heis-backend, 挂了 2 秒重启
while (true) {
  try {
    const proc = Bun.spawn(['./go-backend/heis-backend'], { stdio: ['ignore', 'inherit', 'inherit'] });
    await proc.exited;
  } catch (e) { console.error('Go crashed:', e); }
  console.log('[start-go] Go exited, restarting in 2s...');
  await Bun.sleep(2000);
}
