#!/usr/bin/env python3
"""Generate static data for the Beijing-time 2026 World Cup web dashboard."""
from __future__ import annotations

import json
import math
import os
import re
import sys
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, time
from pathlib import Path
from zoneinfo import ZoneInfo

BJ = ZoneInfo("Asia/Shanghai")
UTC = ZoneInfo("UTC")
PROJECT_DIR = Path(__file__).resolve().parents[1]
REPORTS_DIR = PROJECT_DIR / "reports"
WEB_OUT = Path(os.environ.get("WORLDCUP_WEB_OUT", str(PROJECT_DIR)))
DATA_DIR = WEB_OUT / "data"
STATE_DIR = PROJECT_DIR / "state"
HISTORY_FILE = STATE_DIR / "web_predictions_history.json"
SOURCE_CACHE = STATE_DIR / "espn_scoreboard_web.json"
SUMMARY_CACHE_DIR = STATE_DIR / "espn_summaries"
ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"
UA = {"User-Agent": "WorldCupBeijingDashboard/1.0 (+local static report)"}
# Manual duplicate/noisy report exclusions for the dashboard stats audit trail.
# 2026-06-20-02-.md repeats predictions already present in 2026-06-20.md.
EXCLUDED_REPORT_FILES = {"2026-06-20-02-.md"}

ZH = {
    "United States": "美国", "Australia": "澳大利亚", "Scotland": "苏格兰", "Morocco": "摩洛哥",
    "Brazil": "巴西", "Haiti": "海地", "Turkiye": "土耳其", "Türkiye": "土耳其", "Turkey": "土耳其", "Paraguay": "巴拉圭",
    "Czechia": "捷克", "South Africa": "南非", "Bosnia-Herzegovina": "波黑", "Canada": "加拿大", "Qatar": "卡塔尔",
    "Uzbekistan": "乌兹别克斯坦", "Colombia": "哥伦比亚",
    "Netherlands": "荷兰", "Sweden": "瑞典", "Germany": "德国", "Ivory Coast": "科特迪瓦",
    "Ecuador": "厄瓜多尔", "Curacao": "库拉索", "Curaçao": "库拉索", "Tunisia": "突尼斯", "Japan": "日本",
    "Spain": "西班牙", "Saudi Arabia": "沙特阿拉伯", "Belgium": "比利时", "Iran": "伊朗",
    "Uruguay": "乌拉圭", "Cape Verde": "佛得角", "New Zealand": "新西兰", "Egypt": "埃及",
    "Argentina": "阿根廷", "France": "法国", "England": "英格兰", "Portugal": "葡萄牙", "Mexico": "墨西哥",
    "Canada": "加拿大", "Italy": "意大利", "Croatia": "克罗地亚", "Denmark": "丹麦", "Poland": "波兰",
    "Austria": "奥地利", "Iraq": "伊拉克", "Norway": "挪威", "Jordan": "约旦", "Algeria": "阿尔及利亚",
    "Switzerland": "瑞士", "Serbia": "塞尔维亚", "Korea Republic": "韩国", "South Korea": "韩国",
    "Cameroon": "喀麦隆", "Ghana": "加纳", "Senegal": "塞内加尔", "Nigeria": "尼日利亚",
    "Panama": "巴拿马", "Congo DR": "刚果（金）", "Congo Democratic Republic": "刚果（金）",
}

STRENGTH = {
    # S级：世界顶尖强队
    "Brazil": 96, "Spain": 94, "Argentina": 94, "France": 94,
    # A+级
    "England": 91, "Germany": 90, "Portugal": 90,
    # A级
    "Netherlands": 88, "Belgium": 86, "Croatia": 82, "Colombia": 82,
    # A-级
    "Uruguay": 84, "Italy": 83,
    # B+级
    "Denmark": 80, "Japan": 80, "Switzerland": 79, "Austria": 79,
    "Sweden": 78, "Ecuador": 78, "Morocco": 78, "Norway": 78, "Senegal": 78,
    "United States": 77, "Turkiye": 77, "Turkey": 77, "Poland": 77, "Korea Republic": 77, "South Korea": 77,
    "Algeria": 76, "Czechia": 76, "Mexico": 77,
    # B级
    "Scotland": 75, "Canada": 75, "Iran": 75,
    "Australia": 74, "Ivory Coast": 74, "Egypt": 74,
    "Nigeria": 73, "Tunisia": 73, "Bosnia-Herzegovina": 73, "Paraguay": 73,
    "Serbia": 76,
    # B-级
    "Cameroon": 72, "South Africa": 70, "Saudi Arabia": 70, "Ghana": 70,
    # C+级
    "Congo DR": 69, "Congo Democratic Republic": 69,
    "New Zealand": 68, "Cape Verde": 68, "Panama": 68,
    "Uzbekistan": 66, "Iraq": 67,
    "Jordan": 65, "Qatar": 65,
    # C级
    "Curacao": 64, "Curaçao": 64,
    "Haiti": 63,
}

@dataclass
class Match:
    id: str
    date_utc: datetime
    date_bj: datetime
    home: str
    away: str
    home_zh: str
    away_zh: str
    home_score: int | None
    away_score: int | None
    completed: bool
    status: str
    status_detail: str
    venue: str
    note: str
    link: str
    home_logo: str | None = None
    away_logo: str | None = None

    @property
    def bj_date(self) -> str:
        return self.date_bj.strftime("%Y-%m-%d")

    @property
    def bj_time(self) -> str:
        return self.date_bj.strftime("%H:%M")

    @property
    def title(self) -> str:
        return f"{self.home_zh} vs {self.away_zh}"


def zh(name: str) -> str:
    return ZH.get(name, name)


def outcome(home_score: int, away_score: int) -> str:
    if home_score > away_score:
        return "主胜"
    if home_score < away_score:
        return "客胜"
    return "平"


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=35) as resp:
        return json.loads(resp.read().decode("utf-8"))


def outcome_to_home_code(text: str) -> str:
    """Convert outcome text to the home-team perspective used by half/full display."""
    t = (text or "").strip()
    if t in {"主胜", "胜"}:
        return "胜"
    if t in {"客胜", "负"}:
        return "负"
    if t in {"平", "平局"}:
        return "平"
    return t


def normalize_half_full(text: str) -> str:
    """Canonical half/full code from the home team's perspective, e.g. 平负 / 胜胜."""
    s = re.sub(r"\s+", "", text or "")
    s = s.replace("／", "/").replace("＋", "+").replace("-", "+")
    s = s.replace("半场", "").replace("全场", "")
    s = s.replace("主胜", "胜").replace("客胜", "负").replace("平局", "平")
    s = re.sub(r"[+/|、，,;；]", "", s)
    return s


def format_half_full_home(half: str, full: str) -> str:
    return f"{outcome_to_home_code(half)}{outcome_to_home_code(full)}"


def adjust_half_full_predictions(tendency: str, codes: list[str]) -> list[str]:
    """Keep half/full predictions in the home-team perspective.

    胜/平/负 are displayed relative to the listed home team, so 客胜 scenarios
    should normally include values such as 负负 or 平负. Do not rewrite them to
    home-win codes, otherwise cards like 苏格兰 vs 巴西 would incorrectly show 胜胜.
    """
    return list(codes)


def fetch_halftime_score(event_id: str) -> tuple[int, int] | None:
    """Return (home_ht, away_ht) from ESPN summary linescores when available."""
    if not event_id:
        return None
    SUMMARY_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = SUMMARY_CACHE_DIR / f"{event_id}.json"
    try:
        if cache.exists():
            data = json.loads(cache.read_text(encoding="utf-8"))
        else:
            url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event={event_id}"
            data = fetch_json(url)
            cache.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        comps = (((data.get("header") or {}).get("competitions")) or [])
        if not comps:
            return None
        teams = {c.get("homeAway"): c for c in (comps[0].get("competitors") or [])}
        vals = []
        for side in ("home", "away"):
            line = teams.get(side, {}).get("linescores") or []
            if not line:
                return None
            raw = line[0].get("value", line[0].get("displayValue"))
            vals.append(int(raw))
        return vals[0], vals[1]
    except Exception:
        return None


def parse_events(data: dict) -> list[Match]:
    matches: list[Match] = []
    for e in data.get("events", []):
        comps = e.get("competitions") or []
        if not comps:
            continue
        comp = comps[0]
        competitors = comp.get("competitors") or []
        teams = {c.get("homeAway"): c for c in competitors}
        if "home" not in teams or "away" not in teams:
            continue
        home_c, away_c = teams["home"], teams["away"]
        home = home_c.get("team", {}).get("displayName") or home_c.get("team", {}).get("shortDisplayName") or "Home"
        away = away_c.get("team", {}).get("displayName") or away_c.get("team", {}).get("shortDisplayName") or "Away"
        dt_utc = datetime.fromisoformat((e.get("date") or comp.get("date")).replace("Z", "+00:00")).astimezone(UTC)
        status_type = (e.get("status") or comp.get("status") or {}).get("type", {})
        completed = bool(status_type.get("completed"))
        def score(c):
            s = c.get("score")
            try:
                return int(s) if s is not None and s != "" else None
            except Exception:
                return None
        venue = comp.get("venue") or {}
        addr = venue.get("address") or {}
        venue_name = venue.get("fullName") or venue.get("name") or "待核实"
        if addr.get("city") or addr.get("country"):
            venue_name += f"，{addr.get('city','')}{('，' + addr.get('country')) if addr.get('country') else ''}"
        link = f"https://www.espn.com/soccer/match/_/gameId/{e.get('id')}"
        matches.append(Match(
            id=str(e.get("id") or comp.get("id")), date_utc=dt_utc, date_bj=dt_utc.astimezone(BJ),
            home=home, away=away, home_zh=zh(home), away_zh=zh(away),
            home_score=score(home_c), away_score=score(away_c), completed=completed,
            status=status_type.get("description") or status_type.get("name") or "Scheduled",
            status_detail=status_type.get("detail") or status_type.get("shortDetail") or "",
            venue=venue_name, note=comp.get("altGameNote") or "", link=link,
            home_logo=(home_c.get("team") or {}).get("logo"), away_logo=(away_c.get("team") or {}).get("logo"),
        ))
    return sorted(matches, key=lambda m: m.date_utc)


def team_strength(name: str) -> int:
    return STRENGTH.get(name, 72)


def clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, v))


def decimal_odds(prob: float, payout: float = 0.88, lo: float = 1.15, hi: float = 120.0) -> float:
    prob = max(0.001, min(0.95, prob))
    return round(max(lo, min(hi, payout / prob)), 2)


def home_outcome_code(label: str) -> str:
    if label in {"主胜", "胜"}:
        return "胜"
    if label in {"客胜", "负"}:
        return "负"
    return "平"


def poisson_pmf(k: int, lam: float) -> float:
    return math.exp(-lam) * (lam ** k) / math.factorial(k)


def model_outcome_probs(diff: int) -> dict[str, float]:
    draw = max(0.16, min(0.32, 0.29 - abs(diff) * 0.0045))
    home_share = 1 / (1 + math.exp(-diff / 7.0))
    home = (1 - draw) * home_share
    away = 1 - draw - home
    return {"胜": home, "平": draw, "负": away}


def model_score_probs(diff: int) -> dict[str, float]:
    # Home-team perspective Poisson grid, tuned to football-score ranges.
    home_lam = max(0.45, min(3.2, 1.28 + diff * 0.035))
    away_lam = max(0.35, min(3.0, 1.08 - diff * 0.028))
    out: dict[str, float] = {}
    for h in range(0, 6):
        for a in range(0, 6):
            out[f"{h}-{a}"] = poisson_pmf(h, home_lam) * poisson_pmf(a, away_lam)
    return out


def model_half_full_probs(outcome_probs: dict[str, float]) -> dict[str, float]:
    half = {
        "胜": outcome_probs["胜"] * 0.54 + 0.08,
        "平": 0.44,
        "负": outcome_probs["负"] * 0.54 + 0.08,
    }
    s = sum(half.values())
    half = {k: v / s for k, v in half.items()}
    out: dict[str, float] = {}
    for h, hp in half.items():
        for f, fp in outcome_probs.items():
            corr = 1.42 if h == f else 0.78 if h == "平" else 0.58
            out[f"{h}{f}"] = hp * fp * corr
    total = sum(out.values()) or 1
    return {k: v / total for k, v in out.items()}


def make_sporttery_reference_odds(diff: int, scores: list[tuple[int, int]], half_full: list[str], main_outcome: str) -> dict:
    """China Sports Lottery-style decimal odds from the local model.

    This project has no authenticated official Sporttery odds feed.  Values are
    model-estimated decimal odds in the same play categories: 胜平负 / 比分 / 半全场.
    """
    outcome_probs = model_outcome_probs(diff)
    score_probs = model_score_probs(diff)
    hf_probs = model_half_full_probs(outcome_probs)
    score_labels = [f"{a}-{b}" for a, b in scores]
    outcome_odds = {k: decimal_odds(v, payout=0.89, lo=1.18, hi=12) for k, v in outcome_probs.items()}
    score_odds = {s: decimal_odds(score_probs.get(s, 0.01), payout=0.80, lo=4.0, hi=90) for s in score_labels}
    half_full_odds = {h: decimal_odds(hf_probs.get(h, 0.01), payout=0.82, lo=3.2, hi=80) for h in half_full}
    pick = home_outcome_code(main_outcome)
    return {
        "source": "模型参考赔付系数（按体彩玩法格式推算，非体彩官方实际赔率）",
        "outcome": outcome_odds,
        "outcome_pick": {"label": pick, "odds": outcome_odds.get(pick)},
        "scores": score_odds,
        "half_full": half_full_odds,
    }


def make_prediction(m: Match) -> dict:
    hs = team_strength(m.home) + 2  # mild home designation advantage even on neutral-ish tournament listing
    aws = team_strength(m.away)
    diff = hs - aws

    if diff >= 18:
        # 碾压级优势：强队对弱旅，大比分碾压概率高
        tendency = "主胜"
        scores = [(3, 0), (2, 0), (4, 1)]
        htft = [("主胜", "主胜"), ("平", "主胜"), ("主胜", "平")]
        risk = "主队实力大幅领先，压迫性节奏下大比分概率较高，需防慢热开局。"
    elif diff >= 12:
        # 明显优势：主队更强但不至于碾压
        tendency = "主胜"
        scores = [(2, 0), (3, 1), (2, 1)]
        htft = [("主胜", "主胜"), ("平", "主胜"), ("主胜", "平")]
        risk = "主队整体实力占优明显，但世界杯氛围下弱队防守投入度高，首球关键。"
    elif diff >= 9:
        # 较大优势
        tendency = "主胜"
        scores = [(2, 1), (2, 0), (1, 0)]
        htft = [("平", "主胜"), ("主胜", "主胜"), ("主胜", "平")]
        risk = "主队占优，但世界杯大赛节奏谨慎，防守密度会压制进球数。"
    elif diff >= 5:
        # 小优势偏主队
        tendency = "主胜，防平"
        scores = [(2, 1), (1, 0), (1, 1)]
        htft = [("平", "主胜"), ("主胜", "主胜"), ("平", "平")]
        risk = "主队纸面与节奏略优，平局风险来自打不开局面。"
    elif diff >= 2:
        # 微弱主队优势
        tendency = "主胜，防平"
        scores = [(1, 0), (2, 1), (1, 1)]
        htft = [("平", "主胜"), ("平", "平"), ("主胜", "主胜")]
        risk = "主队略有上风，但差距有限，平局仍是合理结局。"
    elif diff <= -18:
        # 客队碾压
        tendency = "客胜"
        scores = [(0, 3), (0, 2), (1, 3)]
        htft = [("客胜", "客胜"), ("平", "客胜"), ("客胜", "平")]
        risk = "客队实力大幅领先，高比分客胜概率较高，主队难以组织有效进攻。"
    elif diff <= -12:
        # 客队明显优势
        tendency = "客胜"
        scores = [(0, 2), (1, 3), (0, 1)]
        htft = [("客胜", "客胜"), ("平", "客胜"), ("主胜", "客胜")]
        risk = "客队整体更强，但在中立/主场氛围下主队会拼死防守，需防低比分意外。"
    elif diff <= -9:
        # 较大客队优势
        tendency = "客胜"
        scores = [(0, 2), (1, 2), (0, 1)]
        htft = [("平", "客胜"), ("客胜", "客胜"), ("主胜", "客胜")]
        risk = "客队优势更清晰，若早段进球会扩大控场。"
    elif diff <= -5:
        # 小优势偏客队
        tendency = "客胜，防平"
        scores = [(1, 2), (0, 1), (1, 1)]
        htft = [("平", "客胜"), ("客胜", "客胜"), ("平", "平")]
        risk = "客队整体更稳，但杯赛小组赛节奏可能偏谨慎。"
    elif diff <= -2:
        # 微弱客队优势
        tendency = "客胜，防平"
        scores = [(0, 1), (1, 2), (1, 1)]
        htft = [("平", "客胜"), ("平", "平"), ("客胜", "客胜")]
        risk = "客队略有上风，主队主场动力可能制造变数，平局可防。"
    else:
        # diff 在 -1 到 1：真正均势
        tendency = "平局倾向，双方不败均可防"
        scores = [(1, 1), (0, 0), (1, 0)]
        htft = [("平", "平"), ("平", "主胜"), ("主胜", "平")]
        risk = "两队实力几乎相当，首球与定位球将主导走势，低比分平局概率最高。"

    main_outcome = outcome(*scores[0])
    half_full = adjust_half_full_predictions(tendency, [format_half_full_home(h, f) for h, f in htft])
    odds = make_sporttery_reference_odds(diff, scores, half_full, main_outcome)
    return {
        "match_id": m.id,
        "generated_for_date": m.bj_date,
        "tendency": tendency,
        "primary_outcome": main_outcome,
        "scores": [f"{a}-{b}" for a, b in scores],
        "score_pairs": scores,
        "half_full": half_full,
        "half_full_pairs": htft,
        "odds": odds,
        "analysis": build_analysis(m, diff, risk),
    }


def build_analysis(m: Match, diff: int, risk: str) -> str:
    stronger = m.home_zh if diff >= 0 else m.away_zh
    weaker = m.away_zh if diff >= 0 else m.home_zh
    if abs(diff) >= 18:
        edge = f"{stronger}实力大幅领先，技术、体系和阵容深度全面压制{weaker}。"
    elif abs(diff) >= 12:
        edge = f"{stronger}整体实力、阵地推进和替补深度明显占优，{weaker}需要高效反击才能制造变数。"
    elif abs(diff) >= 9:
        edge = f"{stronger}整体实力占优，但世界杯大赛节奏下{weaker}防守投入度更高。"
    elif abs(diff) >= 5:
        edge = f"{stronger}略占上风，但{weaker}具备通过防守密度和转换制造麻烦的空间。"
    elif abs(diff) >= 2:
        edge = f"两队差距有限，{stronger}略有上风，但首球和定位球将显著改变比赛走势。"
    else:
        edge = "两队实力几乎相当，比赛更可能由临场效率、定位球和换人质量决定。"
    return f"{edge}{risk} 预测仅按赛前公开赛程与基础强弱模型生成，临近开赛请结合首发、伤停和天气。"


def normalize_team_name(name: str) -> str:
    text = re.sub(r"（.*?）|\(.*?\)", "", name or "")
    text = re.sub(r"^(?:主队|客队)\s*[：:]\s*", "", text.strip())
    text = text.replace("｜", " ").replace("|", " ").replace("–", "-").replace("—", "-")
    text = re.sub(r"\s+", " ", text).strip().lower()
    aliases = {
        "usa": "united states", "美国": "united states", "south korea": "korea republic",
        "czechia": "czechia", "turkiye": "turkey", "türkiye": "turkey", "curaçao": "curacao",
        "巴拿马": "panama", "刚果": "congo dr", "刚果（金）": "congo dr", "刚果(金)": "congo dr",
        "dr congo": "congo dr", "congo democratic republic": "congo dr",
    }
    if text in aliases:
        return aliases[text]
    for eng, cn in ZH.items():
        if text == cn.lower():
            return aliases.get(eng.lower(), eng.lower())
    return text


def split_prediction_items(raw: str) -> list[str]:
    raw = raw.strip().rstrip("。.")
    parts = re.split(r"[；;、，,]\s*", raw)
    return [p.strip() for p in parts if p.strip()]


def split_score_items(raw: str) -> list[str]:
    items = split_prediction_items(raw)
    out = []
    for item in items:
        m = re.search(r"(\d+)\s*-\s*(\d+)", item)
        out.append(f"{m.group(1)}-{m.group(2)}" if m else item)
    return out


def primary_outcome_from_text(tendency: str, scores: list[str]) -> str | None:
    t = tendency or ""
    if "主胜" in t:
        return "主胜"
    if "客胜" in t:
        return "客胜"
    if "平" in t:
        return "平"
    if scores:
        m = re.search(r"(\d+)\s*-\s*(\d+)", scores[0])
        if m:
            return outcome(int(m.group(1)), int(m.group(2)))
    return None


def report_date_bounds() -> tuple[datetime.date | None, datetime.date | None]:
    dates = []
    if REPORTS_DIR.exists():
        for p in REPORTS_DIR.glob("*.md"):
            m = re.match(r"(\d{4}-\d{2}-\d{2})", p.name)
            if m:
                dates.append(datetime.fromisoformat(m.group(1)).date())
    if not dates:
        return None, None
    return min(dates), max(dates)


def parse_report_predictions() -> list[dict]:
    """Parse markdown reports as the primary historical prediction source.

    The reports under PROJECT_DIR/reports are treated as the audit trail:
    each prediction block contributes score picks, WDL tendency, half/full-time picks,
    and later gets reconciled against ESPN actual results.
    """
    rows: list[dict] = []
    if not REPORTS_DIR.exists():
        return rows
    heading_re = re.compile(
        r"^(?:#{2,3})\s*(?:\d+\.\s*)?(?P<md>\d{2}(?:-|月)\d{2}(?:日)?)\s+(?P<hm>\d{2}:\d{2})\s*[｜|]?\s*(?P<teams>.+?)\s*(?:[｜|].*)?$",
        re.M,
    )
    for path in sorted(REPORTS_DIR.glob("*.md")):
        if path.name in EXCLUDED_REPORT_FILES:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        fm = re.match(r"(\d{4})-(\d{2})-(\d{2})", path.name)
        report_year = int(fm.group(1)) if fm else datetime.now(BJ).year
        report_date = f"{fm.group(1)}-{fm.group(2)}-{fm.group(3)}" if fm else ""
        matches = list(heading_re.finditer(text))
        for idx, h in enumerate(matches, 1):
            block = text[h.end(): matches[idx].start() if idx < len(matches) else len(text)]
            score_m = re.search(r"[-*]\s*[34]个比分预测：\s*(.+)", block)
            hf_m = re.search(r"[-*]\s*[34]个半全场预测：\s*(.+)", block)
            tendency_m = re.search(r"[-*]\s*胜平负倾向：\s*(.+)", block)
            if not (score_m or hf_m or tendency_m):
                continue
            teams = re.sub(r"\s*[-—].*$", "", h.group("teams")).strip()
            tvs = re.split(r"\s+vs\s+", teams, flags=re.I)
            if len(tvs) != 2:
                continue
            home_raw, away_raw = [re.sub(r"^(?:主队|客队)\s*[：:]\s*", "", re.sub(r"（.*?）|\(.*?\)", "", x).strip()) for x in tvs]
            md = h.group("md").replace("月", "-").replace("日", "")
            date = f"{report_year}-{md}"
            scores = split_score_items(score_m.group(1)) if score_m else []
            half_full_raw = split_prediction_items(hf_m.group(1)) if hf_m else []
            tendency = tendency_m.group(1).strip() if tendency_m else ""
            half_full = adjust_half_full_predictions(tendency, [normalize_half_full(x) for x in half_full_raw if normalize_half_full(x)])
            rows.append({
                "source": "reports",
                "source_file": str(path),
                "source_file_name": path.name,
                "source_report_date": report_date,
                "source_index": idx,
                "report_match_key": f"{path.name}#{idx}",
                "date": date,
                "time": h.group("hm"),
                "date_bj": f"{date}T{h.group('hm')}:00+08:00",
                "home_zh": home_raw if home_raw in ZH.values() else zh(home_raw),
                "away_zh": away_raw if away_raw in ZH.values() else zh(away_raw),
                "home": home_raw,
                "away": away_raw,
                "title": f"{home_raw} vs {away_raw}",
                "prediction": {
                    "tendency": tendency,
                    "primary_outcome": primary_outcome_from_text(tendency, scores),
                    "scores": scores,
                    "half_full": half_full,
                },
            })
    return rows


def reconcile_report_predictions(report_rows: list[dict], matches: list[Match]) -> list[dict]:
    by_date = {}
    for m in matches:
        by_date.setdefault(m.bj_date, []).append(m)
    out = []
    for rec in report_rows:
        cands = by_date.get(rec.get("date"), [])
        home_keys = {normalize_team_name(rec.get("home", "")), normalize_team_name(rec.get("home_zh", ""))}
        away_keys = {normalize_team_name(rec.get("away", "")), normalize_team_name(rec.get("away_zh", ""))}
        found = None
        for m in cands:
            mh = {normalize_team_name(m.home), normalize_team_name(m.home_zh)}
            ma = {normalize_team_name(m.away), normalize_team_name(m.away_zh)}
            if (home_keys & mh and away_keys & ma) or (home_keys & ma and away_keys & mh):
                found = m
                break
        row = dict(rec)
        if found:
            row.update({
                "match_id": found.id,
                "date_bj": found.date_bj.isoformat(),
                "date": found.bj_date,
                "time": found.bj_time,
                "home": found.home,
                "away": found.away,
                "home_zh": found.home_zh,
                "away_zh": found.away_zh,
                "title": found.title,
                "status": found.status,
                "status_detail": found.status_detail,
                "link": found.link,
            })
            if found.completed and found.home_score is not None and found.away_score is not None:
                actual_score = f"{found.home_score}-{found.away_score}"
                actual_outcome = outcome(found.home_score, found.away_score)
                pred = row.get("prediction", {})
                ht = fetch_halftime_score(found.id)
                actual_half_full = None
                half_full_hit = None
                if ht is not None:
                    half_outcome = outcome(ht[0], ht[1])
                    actual_half_full = format_half_full_home(half_outcome, actual_outcome)
                    half_full_hit = normalize_half_full(actual_half_full) in {normalize_half_full(x) for x in pred.get("half_full", [])}
                row["completed"] = True
                row["actual"] = {"score": actual_score, "outcome": actual_outcome, "home_score": found.home_score, "away_score": found.away_score}
                if ht is not None:
                    row["actual"].update({"half_time_score": f"{ht[0]}-{ht[1]}", "half_full": actual_half_full})
                row["hit"] = {
                    "exact_score": actual_score in pred.get("scores", []),
                    "outcome": actual_outcome == pred.get("primary_outcome"),
                    "half_full": half_full_hit,
                    "half_full_note": "已从 ESPN summary linescores 读取半场比分。" if ht is not None else "当前数据源未返回半场比分，半全场命中率暂按待统计展示。",
                }
            else:
                row["completed"] = False
        else:
            row["matched"] = False
            row["completed"] = False
        out.append(row)
    return out


def calc_stats_from_records(rows: list[dict]) -> dict:
    completed = [r for r in rows if r.get("completed") and r.get("hit")]
    pending = [r for r in rows if not r.get("completed")]
    total = len(completed)
    exact = sum(1 for r in completed if r["hit"].get("exact_score"))
    outcome_hits = sum(1 for r in completed if r["hit"].get("outcome"))
    half_full_known = [r for r in completed if r["hit"].get("half_full") is not None]
    half_full_hits = sum(1 for r in half_full_known if r["hit"].get("half_full"))
    by_date = {}
    for r in completed:
        d = r.get("date") or (r.get("date_bj", "")[:10])
        item = by_date.setdefault(d, {"date": d, "total": 0, "score_hits": 0, "outcome_hits": 0, "half_full_hits": 0, "half_full_total": 0})
        item["total"] += 1
        item["score_hits"] += 1 if r["hit"].get("exact_score") else 0
        item["outcome_hits"] += 1 if r["hit"].get("outcome") else 0
        if r["hit"].get("half_full") is not None:
            item["half_full_total"] += 1
            item["half_full_hits"] += 1 if r["hit"].get("half_full") else 0
    for item in by_date.values():
        item["score_rate"] = round(item["score_hits"] / item["total"] * 100, 1) if item["total"] else 0
        item["outcome_rate"] = round(item["outcome_hits"] / item["total"] * 100, 1) if item["total"] else 0
        item["half_full_rate"] = round(item["half_full_hits"] / item["half_full_total"] * 100, 1) if item["half_full_total"] else None
    report_rows = [r for r in rows if r.get("source_type") != "dashboard_history"]
    dashboard_history_rows = [r for r in rows if r.get("source_type") == "dashboard_history"]
    report_files_with_predictions = {
        r.get("source_file_name") for r in report_rows if r.get("source_file_name")
    }
    return {
        "source": "reports+dashboard_history",
        "source_label": f"{REPORTS_DIR} Markdown 报告 + 页面自动预测历史",
        "report_files_total": len([p for p in REPORTS_DIR.glob("*.md") if p.name not in EXCLUDED_REPORT_FILES]) if REPORTS_DIR.exists() else 0,
        "report_files_with_predictions": len(report_files_with_predictions),
        "report_predictions_total": len(report_rows),
        "dashboard_history_predictions_total": len(dashboard_history_rows),
        "audited_predictions_total": len(rows),
        "pending_total": len(pending),
        "completed_total": total,
        "exact_score_hits": exact,
        "outcome_hits": outcome_hits,
        "exact_score_rate": round(exact / total * 100, 1) if total else None,
        "outcome_rate": round(outcome_hits / total * 100, 1) if total else None,
        "half_full_rate": round(half_full_hits / len(half_full_known) * 100, 1) if half_full_known else None,
        "half_full_hits": half_full_hits,
        "half_full_total": len(half_full_known),
        "half_full_note": "半全场统计已按 ESPN summary 半场比分计算。" if half_full_known else "半全场命中统计需稳定半场比分源；当前未取到可用半场比分。",
        "by_date": sorted(by_date.values(), key=lambda x: x.get("date", "")),
        "recent": sorted(completed, key=lambda r: r.get("date_bj", ""), reverse=True)[:30],
        "pending": sorted(pending, key=lambda r: r.get("date_bj", ""))[:30],
    }


def merge_history_records_for_stats(report_rows: list[dict], history: dict) -> list[dict]:
    """Merge durable dashboard predictions with parsed Markdown reports for stats.

    The report parser only sees matches that were written into local Markdown files.
    When ESPN later exposes a fuller slate, update_history() keeps the dashboard's own
    pre-match predictions in history.json. Include those records here so the
    "recent settled" comparison does not silently drop same-day matches that were
    predicted by the dashboard but missing from a Markdown report.
    """
    merged: dict[str, dict] = {}

    def row_key(r: dict) -> str:
        return str(r.get("match_id") or "|".join([
            str(r.get("date_bj") or r.get("date") or ""),
            str(r.get("title") or ""),
        ]))

    for row in report_rows:
        merged[row_key(row)] = row

    for rec in history.get("predictions", {}).values():
        if not rec.get("completed") or not rec.get("hit"):
            continue
        key = row_key(rec)
        if key in merged:
            continue
        row = dict(rec)
        row["source_type"] = "dashboard_history"
        row["source_file_name"] = row.get("source_file_name") or "页面自动预测历史"
        row.setdefault("matched", True)
        merged[key] = row

    return list(merged.values())


def load_history() -> dict:
    if HISTORY_FILE.exists():
        try:
            return json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
        except Exception:
            backup = HISTORY_FILE.with_suffix(".broken.json")
            backup.write_text(HISTORY_FILE.read_text(encoding="utf-8", errors="ignore"), encoding="utf-8")
    return {"version": 1, "predictions": {}}


def save_history(history: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    HISTORY_FILE.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")


def update_history(history: dict, matches: list[Match], target_matches: list[Match]) -> None:
    preds = history.setdefault("predictions", {})
    # add/refresh predictions for target day until match starts/completes; keep same deterministic values
    now = datetime.now(BJ)
    for m in target_matches:
        pred = make_prediction(m)
        rec = preds.get(m.id, {})
        if not rec or not rec.get("completed"):
            rec.update({
                "match_id": m.id,
                "date_bj": m.date_bj.isoformat(),
                "date": m.bj_date,
                "home": m.home,
                "away": m.away,
                "home_zh": m.home_zh,
                "away_zh": m.away_zh,
                "title": m.title,
                "predicted_at": now.isoformat(),
                "prediction": pred,
            })
            preds[m.id] = rec
    # update actuals for all completed matches we know, including previous predictions
    by_id = {m.id: m for m in matches}
    for mid, rec in list(preds.items()):
        m = by_id.get(mid)
        if not m or not m.completed or m.home_score is None or m.away_score is None:
            continue
        pred = rec.get("prediction", {})
        actual_score = f"{m.home_score}-{m.away_score}"
        actual_outcome = outcome(m.home_score, m.away_score)
        rec["completed"] = True
        rec["actual"] = {
            "home_score": m.home_score,
            "away_score": m.away_score,
            "score": actual_score,
            "outcome": actual_outcome,
            "status": m.status,
        }
        rec["hit"] = {
            "exact_score": actual_score in pred.get("scores", []),
            "outcome": actual_outcome == pred.get("primary_outcome"),
            "half_full": None,
            "half_full_note": "ESPN scoreboard 当前未稳定提供半场比分，半全场命中率暂不纳入总命中率。",
        }


def calc_stats(history: dict) -> dict:
    rows = list(history.get("predictions", {}).values())
    completed = [r for r in rows if r.get("completed") and r.get("hit")]
    total = len(completed)
    exact = sum(1 for r in completed if r["hit"].get("exact_score"))
    outcome_hits = sum(1 for r in completed if r["hit"].get("outcome"))
    by_date = {}
    for r in completed:
        d = r.get("date") or (r.get("date_bj", "")[:10])
        item = by_date.setdefault(d, {"date": d, "total": 0, "score_hits": 0, "outcome_hits": 0})
        item["total"] += 1
        item["score_hits"] += 1 if r["hit"].get("exact_score") else 0
        item["outcome_hits"] += 1 if r["hit"].get("outcome") else 0
    for item in by_date.values():
        item["score_rate"] = round(item["score_hits"] / item["total"] * 100, 1) if item["total"] else 0
        item["outcome_rate"] = round(item["outcome_hits"] / item["total"] * 100, 1) if item["total"] else 0
    recent = sorted(completed, key=lambda r: r.get("date_bj", ""), reverse=True)[:20]
    return {
        "completed_total": total,
        "exact_score_hits": exact,
        "outcome_hits": outcome_hits,
        "exact_score_rate": round(exact / total * 100, 1) if total else None,
        "outcome_rate": round(outcome_hits / total * 100, 1) if total else None,
        "half_full_rate": None,
        "half_full_note": "半全场命中统计需半场比分源；当前 ESPN scoreboard 未稳定提供，页面先展示预测项与待统计状态。",
        "by_date": sorted(by_date.values(), key=lambda x: x.get("date", "")),
        "recent": recent,
    }


def as_match_dict(m: Match, include_pred: bool = False) -> dict:
    d = {
        "id": m.id, "date_bj": m.date_bj.isoformat(), "date": m.bj_date, "time": m.bj_time,
        "home": m.home, "away": m.away, "home_zh": m.home_zh, "away_zh": m.away_zh,
        "title": m.title, "status": m.status, "status_detail": m.status_detail, "completed": m.completed,
        "home_score": m.home_score, "away_score": m.away_score, "venue": m.venue, "note": m.note,
        "link": m.link, "home_logo": m.home_logo, "away_logo": m.away_logo,
    }
    if include_pred:
        d["prediction"] = make_prediction(m)
    return d


def main() -> int:
    now = datetime.now(BJ)
    report_rows = parse_report_predictions()
    min_report_date, _ = report_date_bounds()
    # Query enough UTC range to cover the whole local reports audit trail plus upcoming predictions.
    default_start = now.date() - timedelta(days=4)
    if min_report_date:
        default_start = min(default_start, min_report_date - timedelta(days=1))
    start = default_start.strftime("%Y%m%d")
    end = (now.date() + timedelta(days=5)).strftime("%Y%m%d")
    url = f"{ESPN_BASE}?dates={start}-{end}&limit=300"
    data = fetch_json(url)
    SOURCE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    SOURCE_CACHE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    matches = parse_events(data)

    today = now.date()
    yesterday = today - timedelta(days=1)
    tomorrow = today + timedelta(days=1)
    day_after = today + timedelta(days=2)

    def on_date(m: Match, d) -> bool:
        return m.date_bj.date() == d

    today_matches = [m for m in matches if on_date(m, today)]
    yesterday_matches = [m for m in matches if on_date(m, yesterday)]
    tomorrow_matches = [m for m in matches if on_date(m, tomorrow)]
    target_matches = [m for m in matches if on_date(m, tomorrow) and not m.completed]
    if not target_matches:
        # Fallback: if the local tomorrow bucket is empty, use the next scheduled slate after Beijing tomorrow starts.
        start_dt = datetime.combine(tomorrow, time.min, BJ)
        target_matches = [m for m in matches if (not m.completed and m.date_bj >= start_dt)]

    history = load_history()
    update_history(history, matches, target_matches)
    save_history(history)
    report_predictions = reconcile_report_predictions(report_rows, matches)
    audited_predictions = merge_history_records_for_stats(report_predictions, history)
    stats = calc_stats_from_records(audited_predictions)

    current = {
        "generated_at_bj": now.isoformat(),
        "generated_at_label": now.strftime("%Y-%m-%d %H:%M:%S 北京时间"),
        "timezone": "Asia/Shanghai",
        "source": {"name": "ESPN FIFA World Cup scoreboard API", "url": url},
        "report_source": {
            "directory": str(REPORTS_DIR),
            "windows_directory": "C:\\nginx-1.24.0\\html\\worldcup2\\reports",
            "files_total": stats.get("report_files_total", 0),
            "predictions_total": stats.get("report_predictions_total", 0),
            "description": "命中率统计以本地 Markdown 预测报告为主数据源；若报告漏掉同日已预测比赛，会补入页面自动预测历史，再与 ESPN 完赛比分核对。",
        },
        "dates": {
            "today": today.isoformat(), "yesterday": yesterday.isoformat(),
            "tomorrow": tomorrow.isoformat(), "prediction_target": tomorrow.isoformat(),
        },
        "summary": {
            "today_count": len(today_matches), "tomorrow_count": len(tomorrow_matches),
            "prediction_count": len(target_matches), "completed_known": sum(1 for m in matches if m.completed),
        },
        "sections": {
            "yesterday_results": [as_match_dict(m) for m in yesterday_matches],
            "today_matches": [as_match_dict(m) for m in today_matches],
            "tomorrow_matches": [as_match_dict(m) for m in tomorrow_matches],
            "day_after_predictions": [as_match_dict(m, include_pred=True) for m in target_matches],
            "report_predictions": report_predictions,
            "all_known_matches": [as_match_dict(m) for m in matches],
        },
        "stats": stats,
        "risk_notice": "预测仅供娱乐和信息参考，不构成投注建议；请遵守所在地法律法规，理性看球。",
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "current.json").write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    (DATA_DIR / "history.json").write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Generated {DATA_DIR / 'current.json'}")
    print(f"Prediction target {tomorrow.isoformat()}, matches={len(target_matches)}")
    for m in target_matches:
        print(f"- {m.date_bj:%m-%d %H:%M} {m.title}")
    print(f"Report source {REPORTS_DIR}, files={stats.get('report_files_total', 0)}, parsed_predictions={stats.get('report_predictions_total', 0)}, completed={stats.get('completed_total', 0)}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
