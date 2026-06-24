# Fly.io 部署说明

这个项目可以用 Docker 部署到 Fly.io。前端会先构建到 `dist`，然后由 Express 同时提供页面和 API。

## 推荐配置

- App: `investment-simulation-zdstyfx`
- Region: `nrt`
- Port: `3001`
- Volume mount: `/data`
- SQLite path: `/data/app.sqlite`
- Machine: `shared-cpu-1x / 256MB`
- Idle behavior: 自动停止，访问时自动启动

Fly.io 当前是按量计费。旧的 Legacy Free allowance 才包含免费 `shared-cpu-1x 256MB` VM 和 3GB volume；新账号不一定有永久免费额度。这个配置已经压到最低资源：1 台 256MB 机器、1GB volume、无独立 IPv4。

## 环境变量

`fly.toml` 已经配置：

```text
PORT=3001
DATABASE_PATH=/data/app.sqlite
```

还需要设置 secret：

```bash
flyctl secrets set JWT_SECRET="换成一串随机长字符串"
```

## 首次部署

```bash
flyctl auth login
flyctl apps create investment-simulation-zdstyfx
flyctl volumes create data --region nrt --size 1
flyctl secrets set JWT_SECRET="换成一串随机长字符串"
flyctl deploy
```

部署完成后访问：

```text
https://investment-simulation-zdstyfx.fly.dev/admin
https://investment-simulation-zdstyfx.fly.dev/play
https://investment-simulation-zdstyfx.fly.dev/screen
```

## 重置数据

每次路演前如果要重新开始：

```bash
flyctl ssh console -C "npm run reset:data"
```

默认主办方账号：

```text
admin / admin123
```
