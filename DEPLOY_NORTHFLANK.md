# Northflank 部署说明

这个项目可以作为一个 Docker 服务部署到 Northflank：容器内运行 Express，Express 同时提供 API 和 `dist` 前端静态文件。

## 需要的配置

- Build method: Dockerfile
- Port: `3001`
- Health check path: `/api/health`
- Persistent volume mount path: `/data`
- Environment variables:
  - `PORT=3001`
  - `DATABASE_PATH=/data/app.sqlite`
  - `JWT_SECRET=换成一串随机长字符串`

## 部署步骤

1. 把代码推到 GitHub。
2. 在 Northflank 新建 Project。
3. 新建 Service，选择从 GitHub Repository 部署。
4. Build 方式选择 Dockerfile。
5. 暴露 HTTP 端口 `3001`。
6. 添加一个持久化 Volume，挂载到 `/data`。
7. 添加上面的环境变量。
8. Deploy。

## 访问路径

部署成功后，用 Northflank 给的公网域名访问：

- 主办方控制台：`https://你的域名/admin`
- 小组投资端：`https://你的域名/play`
- 大屏：`https://你的域名/screen`

## 重置数据

如果要每次路演前清空数据，进入容器或使用 Northflank 的 one-off job 执行：

```bash
npm run reset:data
```

注意：这会清空场次、小组、投资和账号数据，并重新生成默认主办方账号。

默认主办方账号：

```text
admin / admin123
```

正式活动前建议改掉默认管理员密码，或临时设置一个强 `JWT_SECRET` 并重新注册/初始化数据。
