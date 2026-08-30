"""Serialize live demo HTTP responses and access logs."""

from __future__ import annotations

import json


class LiveHTTPResponseMixin:
    """Provide shared response headers, serialization, and access logging."""

    def _headers(self, content_type: str) -> None:
        self.send_header("content-type", content_type)
        self.send_header("cache-control", "no-store")
        self.send_header("x-content-type-options", "nosniff")
        self.send_header(
            "content-security-policy",
            "default-src 'self'; script-src 'self' 'unsafe-inline'; "
            "style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
        )

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self._headers(content_type)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status: int, body: dict) -> None:
        self._send(
            status,
            json.dumps(body, ensure_ascii=False).encode(),
            "application/json; charset=utf-8",
        )

    def log_message(self, format: str, *args) -> None:
        print(
            f"{self.command} {self.path} -> {args[1] if len(args) > 1 else '-'}",
            flush=True,
        )
