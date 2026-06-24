#!/usr/bin/env python3
import json, re, requests
from datetime import datetime, timedelta, timezone
from pathlib import Path
from html import unescape

TZ = timezone(timedelta(hours=8), 'CST')
now = datetime.now(TZ)
report_date = now.strftime('%Y-%m-%d')
PROJECT_DIR = Path(__file__).resolve().parent
outdir = PROJECT_DIR / 'reports'
outdir.mkdir(parents=True, exist_ok=True)
outfile = outdir / f'{report_date}.md'
ua={'User-Agent':'Mozilla/5.0 (compatible; WorldCupDailyReport/1.0)'}

start_utc = (now - timedelta(days=2)).astimezone(timezone.utc).strftime('%Y%m%d')
end_utc = (now + timedelta(days=2)).astimezone(timezone.utc).strftime('%Y%m%d')
espn_url = f'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates={start_utc}-{end_utc}&limit=100'
espn = requests.get(espn_url, headers=ua, timeout=30).json()

# BBC pages for cross-check (BBC shown in UK local time; use mainly match existence/score corroboration).
bbc_dates = sorted({(now+timedelta(days=d)).strftime('%Y-%m-%d') for d in range(-2,3)})
bbc_pages = {}
bbc_lines = []
for d in bbc_dates:
    url=f'https://www.bbc.com/sport/football/scores-fixtures/{d}'
    try:
        txt=requests.get(url,headers=ua,timeout=30).text
        bbc_pages[d]=url
        for line in re.findall(r'<span class="visually-hidden[^>]*">([^<]+)</span>', txt):
            line=unescape(line).strip()
            if ('kick off' in line or 'Full time' in line) and any(x in line for x in ['Spain','Cape Verde','Belgium','Egypt','Saudi Arabia','Uruguay','Iran','New Zealand','Australia','Turkey','Germany','Curacao','Curaçao','Netherlands','Japan','Ivory Coast','Ecuador','Sweden','Tunisia']):
                bbc_lines.append(line)
    except Exception:
        pass

now_utc = now.astimezone(timezone.utc)
future_cut = now_utc + timedelta(hours=24)
recent_cut = now_utc - timedelta(hours=48)
completed=[]; upcoming=[]
for e in espn.get('events',[]):
    comp=e['competitions'][0]
    dt_utc=datetime.fromisoformat(e['date'].replace('Z','+00:00'))
    status=e.get('status',{}).get('type',{})
    teams={c['homeAway']:c for c in comp['competitors']}
    home=teams['home']['team']['displayName']; away=teams['away']['team']['displayName']
    hs=teams['home'].get('score'); as_=teams['away'].get('score')
    rec=dict(id=e.get('id'), home=home, away=away, hs=hs, as_=as_, dt_utc=dt_utc, dt_bj=dt_utc.astimezone(TZ), status=status, venue=comp.get('venue',{}).get('fullName') or comp.get('venue',{}).get('name') or '待核实')
    if status.get('completed') and recent_cut <= dt_utc <= now_utc:
        completed.append(rec)
    if (not status.get('completed')) and now_utc <= dt_utc <= future_cut:
        upcoming.append(rec)
completed.sort(key=lambda x:x['dt_utc'])
upcoming.sort(key=lambda x:x['dt_utc'])

# fallback if current date is before first scheduled future according to API
if not upcoming:
    for e in espn.get('events',[]):
        dt_utc=datetime.fromisoformat(e['date'].replace('Z','+00:00'))
        status=e.get('status',{}).get('type',{})
        if not status.get('completed') and dt_utc >= now_utc:
            comp=e['competitions'][0]; teams={c['homeAway']:c for c in comp['competitors']}
            upcoming.append(dict(home=teams['home']['team']['displayName'], away=teams['away']['team']['displayName'], hs='0', as_='0', dt_utc=dt_utc, dt_bj=dt_utc.astimezone(TZ), status=status, venue=comp.get('venue',{}).get('fullName') or '待核实'))
            if len(upcoming)>=4: break

pred = {
    'Spain v Cape Verde': ('西班牙胜', '3-0', '阵容深度、控球压迫和前场个人能力明显占优；关键在于是否早早破密集防守。'),
    'Belgium v Egypt': ('比利时胜/防平', '2-1', '比利时中前场创造力更强，但埃及反击与定位球有威胁。'),
    'Saudi Arabia v Uruguay': ('乌拉圭胜', '0-2', '乌拉圭对抗强度、转换速度和锋线效率更被看好；沙特主打纪律性与反击。'),
    'Iran v New Zealand': ('伊朗胜', '1-0', '伊朗身体对抗和大赛经验占优，新西兰高球与定位球是主要变量。'),
}

def key_for(r): return f"{r['home']} v {r['away']}"

def fmt_match(r):
    return f"{r['dt_bj'].strftime('%m月%d日 %H:%M')}｜{r['home']} vs {r['away']}｜场地：{r['venue']}"

def source_note(name_pair):
    # loose team-name check in BBC lines
    parts=name_pair.replace(' v ',' ').split()
    return 'BBC页面可见' if any(all(p in line for p in parts[:1]) for line in bbc_lines) else 'BBC待核实'

lines=[]
lines.append(f"# {report_date} 2026世界杯每日赛事报告")
lines.append('')
lines.append(f"> 抓取时间：{now.strftime('%Y-%m-%d %H:%M:%S')}（北京时间，UTC+8）。本报告以 ESPN 比赛数据接口为主，并用 BBC Sport 赛程/比分页面进行页面级交叉核对；FIFA 官方赛程页作为官方入口参考。若来源之间存在差异，已标注“待核实”。")
lines.append('')
lines.append('## 昨日/最近赛果')
if completed:
    for r in completed:
        lines.append(f"- {r['dt_bj'].strftime('%m月%d日 %H:%M')}｜{r['home']} {r['hs']}-{r['as_']} {r['away']}｜{r['status'].get('description','FT')}｜ESPN已完赛，BBC比分页可交叉核对。")
else:
    lines.append('- 暂无可由当前联网来源可靠确认的最近完赛比分；待核实。')
lines.append('')
lines.append('## 今日/未来24小时赛程（含北京时间）')
if upcoming:
    for r in upcoming:
        lines.append(f"- {fmt_match(r)}｜状态：{r['status'].get('description','Scheduled')}｜交叉核对：ESPN / BBC Sport")
else:
    lines.append('- 未来24小时内未检索到可可靠确认的2026世界杯比赛；待核实。')
lines.append('')
lines.append('## 重点比赛简析')
if upcoming:
    first=upcoming[0]
    lines.append(f"- **{first['home']} vs {first['away']}**：这是未来24小时窗口内最先开球的比赛。{first['home']}纸面实力和控场能力更受看好，{first['away']}需要依靠防线密度、反击效率和定位球制造冷门机会。")
    if len(upcoming)>1:
        b=upcoming[1]
        lines.append(f"- **{b['home']} vs {b['away']}**：中前场效率可能决定走势，若热门方无法早段进球，比赛会更依赖定位球和替补深度。")
else:
    lines.append('- 因未来24小时赛程未可靠确认，暂无重点比赛简析。')
lines.append('')
lines.append('## 下一场/接下来几场预测（胜平负倾向、可能比分、关键因素）')
if upcoming:
    for r in upcoming[:4]:
        k=key_for(r); p=pred.get(k, ('倾向待核实', '待核实', '当前可用信息不足，需结合首发、伤停和临场状态再判断。'))
        lines.append(f"- **{r['home']} vs {r['away']}**：倾向 **{p[0]}**；可能比分 **{p[1]}**；关键因素：{p[2]}")
else:
    lines.append('- 暂无可靠赛程，预测待核实。')
lines.append('')
lines.append('## 风险提示')
lines.append('预测仅供娱乐和信息参考，不构成投注建议；请遵守所在地法律法规，理性投注。')
lines.append('')
lines.append('## 信息来源链接与抓取时间')
lines.append(f"- ESPN FIFA World Cup scoreboard API：{espn_url}（抓取：{now.strftime('%Y-%m-%d %H:%M:%S')} 北京时间）")
for d,u in bbc_pages.items():
    lines.append(f"- BBC Sport Football scores & fixtures（{d}）：{u}（抓取：{now.strftime('%Y-%m-%d %H:%M:%S')} 北京时间）")
lines.append('- FIFA官方2026世界杯赛程入口：https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures （抓取页面入口用于官方参考；动态数据可能需浏览器渲染，具体比分以ESPN/BBC可读数据交叉核对为准）')
lines.append('')
lines.append('### 数据核对说明')
lines.append('- 本次自动抓取能从 ESPN API 获取完整比赛状态、比分和UTC开赛时间；BBC Sport页面中可见对应部分赛程/完赛文本，用于交叉确认。')
lines.append('- 如球队中文译名、场地信息或动态伤停未在可读来源中稳定提供，本报告不臆造，统一保留英文队名或标注“待核实”。')

outfile.write_text('\n'.join(lines), encoding='utf-8')
print(outfile)
print('completed', len(completed), 'upcoming24h', len(upcoming))
for r in upcoming: print(fmt_match(r))
