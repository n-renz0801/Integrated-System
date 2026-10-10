"""Desktop launcher: runs the Flask app in a background thread and shows it
in a native pywebview window.

    pip install pywebview
    python desktop.py
"""
import socket
import sys
import threading
import time
import urllib.request

import webview
from werkzeug.serving import make_server

from app import app, _ensure_eopcrf1_schema, _ensure_eopcrf2_schema
from models import db

WINDOW_TITLE = "Project MEASURE"


def free_port() -> int:
    """Ask the OS for an unused port so we never clash with something else."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class ServerThread(threading.Thread):
    def __init__(self, flask_app, port):
        super().__init__(daemon=True)
        # threaded=True: the pages fire several API calls at once.
        self.server = make_server("127.0.0.1", port, flask_app, threaded=True)

    def run(self):
        self.server.serve_forever()

    def stop(self):
        self.server.shutdown()


def wait_until_up(url: str, timeout: float = 15.0) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=1)
            return True
        except Exception:
            time.sleep(0.15)
    return False


def init_database():
    """app.py only does this under `if __name__ == "__main__"`, which does
    not run when we import it, so repeat it here (all calls are idempotent)."""
    with app.app_context():
        db.create_all()
        _ensure_eopcrf1_schema()
        _ensure_eopcrf2_schema()


def main():
    init_database()
    port = free_port()
    url = f"http://127.0.0.1:{port}/"

    server = ServerThread(app, port)
    server.start()
    if not wait_until_up(url):
        print("Server failed to start.", file=sys.stderr)
        sys.exit(1)

    webview.create_window(
        WINDOW_TITLE,
        url,
        width=1366,
        height=850,
        min_size=(1000, 650),
    )
    try:
        webview.start()  # blocks until the window is closed
    finally:
        server.stop()


if __name__ == "__main__":
    main()