#!/usr/bin/env python3
"""Local refresh bridge for the World Cup static dashboard.

The dashboard is served as static files by nginx, so browser JavaScript cannot
run the Python data generator directly. This tiny localhost-only HTTP service
exposes POST /refresh, runs web/generate_web_data.py, and returns JSON status.
"""
from __future__ import annotations

import json
import subprocess
import sys
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "web" / "generate_web_data.py"
LOG_DIR = ROOT / "logs"
LOG_FILE = LOG_DIR / "refresh_bridge.log"
HOST = "127.0.0.1"
PORT = 8765
_lock = threading.Lock()


def log(message: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(f"[{stamp}] {message}\n")


def run_refresh() -> dict:
    if not GENERATOR.exists():
        return {"ok": False, "message": f"generator not found: {GENERATOR}"}
    if not _lock.acquire(blocking=False):
        return {"ok": False, "busy": True, "message": "刷新正在进行中，请稍后再试。"}
    try:
        start = datetime.now()
        log(f"refresh start: {GENERATOR}")
        proc = subprocess.run(
            [sys.executable, str(GENERATOR)],
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=180,
        )
        output = (proc.stdout or "").strip()
        for line in output.splitlines()[-40:]:
            log(f"generator: {line}")
        elapsed = round((datetime.now() - start).total_seconds(), 1)
        ok = proc.returncode == 0
        log(f"refresh done: ok={ok} code={proc.returncode} elapsed={elapsed}s")
        return {
            "ok": ok,
            "code": proc.returncode,
            "elapsed_seconds": elapsed,
            "message": "数据已重新生成。" if ok else "数据生成失败，请查看日志。",
            "output_tail": output.splitlines()[-12:],
        }
    except subprocess.TimeoutExpired:
        log("refresh timeout")
        return {"ok": False, "message": "刷新超时，生成器运行超过 180 秒。"}
    except Exception as exc:  # noqa: BLE001 - this is an operator bridge
        log(f"refresh error: {exc!r}")
        return {"ok": False, "message": f"刷新失败：{exc}"}
    finally:
        _lock.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "WorldCupRefreshBridge/1.0"

    def _send_json(self, status: int, data: dict) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send_json(204, {})

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") in ("", "/health"):
            self._send_json(200, {"ok": True, "service": "worldcup-refresh-bridge", "root": str(ROOT)})
        else:
            self._send_json(404, {"ok": False, "message": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") == "/refresh":
            result = run_refresh()
            self._send_json(200 if result.get("ok") else 500, result)
        else:
            self._send_json(404, {"ok": False, "message": "not found"})

    def log_message(self, fmt: str, *args) -> None:
        log("http " + (fmt % args))


def main() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    log(f"bridge listening on http://{HOST}:{PORT}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
