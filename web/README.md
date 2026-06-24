# World Cup Beijing Dashboard

静态 Web / 项目统一目录：`C:\nginx-1.24.0\html\worldcup2`

数据生成脚本：`/mnt/c/nginx-1.24.0/html/worldcup2/web/generate_web_data.py`

访问地址：`http://localhost/worldcup2/`

功能：

- 北京时间每日报告
- 明天完整赛程预测：每场胜平负、3个比分、3个半全场
- 预测视图 / 命中率视图 / 购买推荐的图片导出
- 历史预测命中率统计视图
- Windows 登录时自动生成数据、启动 nginx、打开网页

本目录下的 `reports/`、`state/`、`data/` 是当前有效数据源和输出位置。
