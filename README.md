# 2026 世界杯仪表盘项目（worldcup2）

本目录是当前统一管理位置：`C:\nginx-1.24.0\html\worldcup2`（WSL: `/mnt/c/nginx-1.24.0/html/worldcup2`）。

## 目录结构

- `index.html`、`assets/`：本地 nginx 静态页面。
- `data/`：页面读取的生成数据，主要是 `data/current.json` 和 `data/history.json`。
- `web/generate_web_data.py`：仪表盘数据生成器；默认读取本目录下的 `reports/` 和 `state/`，并写回本目录 `data/`。
- `reports/`：Markdown 预测/赛果报告，命中率统计以这里为主数据源。
- `state/`：ESPN 缓存、预测历史、赛前提醒去重状态。
- `logs/`：Windows 启动/刷新脚本日志。
- `start_worldcup_dashboard.ps1`：Windows 登录后生成数据、启动 nginx、打开 `http://localhost/worldcup2/`。
- `refresh_worldcup_data.ps1`：Windows 定时刷新 JSON 数据。
- `generate_report.py`、`check_reminders.py`：报告和提醒辅助脚本。

## 常用命令

从 WSL 手动刷新页面数据：

```bash
python3 /mnt/c/nginx-1.24.0/html/worldcup2/web/generate_web_data.py
```

验证：

```bash
python3 -m json.tool /mnt/c/nginx-1.24.0/html/worldcup2/data/current.json >/dev/null
node --check /mnt/c/nginx-1.24.0/html/worldcup2/assets/app.js
```

浏览器访问：

```text
http://localhost/worldcup2/
```

## Windows 计划任务

当前计划任务已指向本目录：

- `WorldCupDashboardAutoOpen` → `C:\nginx-1.24.0\html\worldcup2\start_worldcup_dashboard.ps1`
- `WorldCupDashboardDataRefresh` → `C:\nginx-1.24.0\html\worldcup2\refresh_worldcup_data.ps1`

注意：预测仅供娱乐和信息参考，不构成投注建议；请遵守所在地法律法规，理性投注。
