"""Dispatch validated live demo requests to the analysis engine."""

from __future__ import annotations

import json
from typing import Callable


class LiveHTTPDispatchMixin:
    """Stream engine events for validated live demo requests."""

    def _dispatch_stream(self, request: dict) -> None:
        def emit(event: dict) -> None:
            self.wfile.write((json.dumps(event, ensure_ascii=False) + "\n").encode())
            self.wfile.flush()

        try:
            self._dispatch(request, emit)
        except self.live_error_type as error:
            try:
                event = {"type": "error", "message": str(error)}
                if error.suggested_instruction:
                    event["suggested_instruction"] = error.suggested_instruction
                emit(event)
            except (BrokenPipeError, ConnectionResetError):
                return
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as error:  # noqa: BLE001 — details stay server-side
            recovery_message = self.auth_recovery_message(error)
            if recovery_message:
                print("live query failed: Google authentication expired", flush=True)
                emit({"type": "error", "message": recovery_message})
                return
            print(f"live query failed: {type(error).__name__}", flush=True)
            emit(
                {
                    "type": "error",
                    "message": "生成または実行に失敗しました。端末ログを確認してください。",
                }
            )

    def _dispatch(self, request: dict, emit: Callable[[dict], None]) -> None:
        request_kwargs = (
            {"request_id": request["request_id"]} if request["request_id"] else {}
        )
        if self.path == "/api/consult":
            self.engine.consult(
                request["question"],
                request["history"],
                emit,
                profile=request["profile"],
                **request_kwargs,
            )
        elif self.path == "/api/report":
            self.engine.meeting_report(
                request["build_revision"], emit, **request_kwargs
            )
        elif self.path == "/api/plan":
            self.engine.plan(
                request["question"],
                request["answers"],
                emit,
                analysis_plan=request["analysis_plan"],
                revision_instruction=request["revision_instruction"],
                **request_kwargs,
            )
        elif self.path == "/api/dashboard":
            self.engine.dashboard(
                request["question"],
                emit,
                request["analysis_plan"],
                **request_kwargs,
            )
        else:
            self._dispatch_query(request, emit, request_kwargs)

    def _dispatch_query(
        self,
        request: dict,
        emit: Callable[[dict], None],
        request_kwargs: dict,
    ) -> None:
        if request["profile"] == "bitcoin":
            self.engine.query(
                request["question"],
                emit,
                profile="bitcoin",
                analysis_specification=request["analysis_specification"],
                **request_kwargs,
            )
            return
        if request["analysis_specification"] is not None:
            request_kwargs["analysis_specification"] = request[
                "analysis_specification"
            ]
        if request["clarification_answer"] is not None:
            request_kwargs["clarification_answer"] = request["clarification_answer"]
        self.engine.query(request["question"], emit, **request_kwargs)
