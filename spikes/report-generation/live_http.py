"""Serve and validate the localhost-only live demo HTTP boundary."""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable

from live_http_dispatch import LiveHTTPDispatchMixin
from live_http_response import LiveHTTPResponseMixin
from live_http_validation import LiveHTTPRequestValidationMixin, RequestBodySizeError


API_PATHS = {
    "/api/query",
    "/api/dashboard",
    "/api/plan",
    "/api/report",
    "/api/consult",
    "/api/cancel",
}


class LiveHTTPHandler(
    LiveHTTPDispatchMixin,
    LiveHTTPResponseMixin,
    LiveHTTPRequestValidationMixin,
    BaseHTTPRequestHandler,
):
    """Validate local requests and stream engine events as NDJSON."""

    engine: object
    html: str
    echarts_asset: Path
    max_body_bytes: int
    max_plan_body_bytes: int
    max_rejected_body_bytes: int
    max_question_chars: int
    planner: object
    live_error_type: type[Exception]
    period_for_question: Callable[[str], dict[str, str]]
    dashboard_sections_for_plan: Callable[[str, dict, str], tuple[dict, list[dict]]]
    analysis_section_for_specification: Callable[[str, dict, str], tuple[dict, dict]]
    auth_recovery_message: Callable[[Exception], str | None]

    def do_GET(self) -> None:
        if self.path == "/":
            self._send(200, self.html.encode(), "text/html; charset=utf-8")
        elif self.path == "/assets/echarts.min.js":
            self._send(
                200,
                self.echarts_asset.read_bytes(),
                "application/javascript; charset=utf-8",
            )
        else:
            self._send(204 if self.path == "/favicon.ico" else 404, b"", "text/plain")

    def do_POST(self) -> None:
        if self.path not in API_PATHS:
            self._send_json(404, {"error": "not found"})
            return
        if not self._request_origin_is_allowed():
            return
        try:
            request = self._validated_request()
            if self.path == "/api/cancel":
                self._send_json(
                    200,
                    {"cancelled": self.engine.cancel(request["request_id"])},
                )
                return
        except RequestBodySizeError as error:
            self._discard_rejected_body(error.content_length)
            self._send_json(400, {"error": str(error)})
            return
        except self._validation_errors() as error:
            self._send_json(400, {"error": str(error)})
            return
        except Exception as error:  # noqa: BLE001 — preserve the browser connection
            print(f"request validation failed: {type(error).__name__}", flush=True)
            self._send_json(
                500,
                {"error": "生成または実行に失敗しました。端末ログを確認してください。"},
            )
            return
        self.send_response(200)
        self._headers("application/x-ndjson; charset=utf-8")
        self.end_headers()
        self._dispatch_stream(request)

def create_server(
    host: str, port: int, handler: type[BaseHTTPRequestHandler]
) -> ThreadingHTTPServer:
    """Bind a configured handler to one local threaded HTTP server."""
    return ThreadingHTTPServer((host, port), handler)
