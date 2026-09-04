"""Parse and validate live demo HTTP requests."""

from __future__ import annotations

import json
import re


class RequestBodySizeError(ValueError):
    """Report a rejected Content-Length that may be drained safely."""

    def __init__(self, content_length: int) -> None:
        super().__init__("request body is empty or too large")
        self.content_length = content_length


class LiveHTTPRequestValidationMixin:
    """Validate request origins, fields, and endpoint-specific contracts."""

    def _request_origin_is_allowed(self) -> bool:
        content_type = (
            self.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        )
        origin = self.headers.get("origin")
        allowed = {
            f"http://127.0.0.1:{self.server.server_port}",
            f"http://localhost:{self.server.server_port}",
        }
        if content_type != "application/json":
            self._send_json(415, {"error": "content-type must be application/json"})
            return False
        if origin is not None and origin not in allowed:
            self._send_json(403, {"error": "cross-origin requests are not allowed"})
            return False
        return True

    def _validated_request(self) -> dict:
        length = int(self.headers.get("content-length", "0"))
        max_body_bytes = (
            self.max_plan_body_bytes
            if self.path in {"/api/dashboard", "/api/plan"}
            else self.max_body_bytes
        )
        if length <= 0:
            raise ValueError("request body is empty or too large")
        if length > max_body_bytes:
            raise RequestBodySizeError(length)
        body = json.loads(self.rfile.read(length))
        request_id = body.get("request_id") if isinstance(body, dict) else None
        self._validate_request_id(request_id)
        if self.path == "/api/cancel":
            if request_id is None:
                raise ValueError("request_id is required")
            return {"request_id": request_id}
        request = self._common_request(body, request_id)
        self._validate_endpoint_request(request)
        return request

    def _discard_rejected_body(self, length: int) -> None:
        """Consume a rejected body only when it fits the transport safety bound."""
        if length > self.max_rejected_body_bytes:
            return
        previous_timeout = self.connection.gettimeout()
        self.connection.settimeout(1.0)
        remaining = length
        try:
            while remaining:
                chunk = self.rfile.read(min(remaining, 65536))
                if not chunk:
                    break
                remaining -= len(chunk)
        except OSError:
            pass
        finally:
            self.connection.settimeout(previous_timeout)
    @staticmethod
    def _validate_request_id(request_id: object) -> None:
        if request_id is not None and (
            not isinstance(request_id, str)
            or not re.fullmatch(r"request-[0-9]{10,16}-[0-9a-f]{4,32}", request_id)
        ):
            raise ValueError("request_id is invalid")

    @staticmethod
    def _common_request(body: object, request_id: str | None) -> dict:
        question = body.get("question") if isinstance(body, dict) else None
        profile = body.get("profile", "ga4") if isinstance(body, dict) else None
        request = {
            "question": question,
            "profile": profile,
            "answers": body.get("answers", {}) if isinstance(body, dict) else None,
            "analysis_plan": (
                body.get("analysis_plan") if isinstance(body, dict) else None
            ),
            "analysis_specification": (
                body.get("analysis_specification") if isinstance(body, dict) else None
            ),
            "clarification_answer": (
                body.get("clarification_answer") if isinstance(body, dict) else None
            ),
            "revision_instruction": (
                body.get("revision_instruction") if isinstance(body, dict) else None
            ),
            "build_revision": (
                body.get("build_revision") if isinstance(body, dict) else None
            ),
            "history": body.get("history", []) if isinstance(body, dict) else None,
            "request_id": request_id,
        }
        if not isinstance(question, str):
            raise ValueError("question must be a string")
        if profile not in {"ga4", "bitcoin"}:
            raise ValueError("profile must be ga4 or bitcoin")
        LiveHTTPRequestValidationMixin._validate_optional_fields(request)
        return request

    @staticmethod
    def _validate_optional_fields(request: dict) -> None:
        analysis_plan = request["analysis_plan"]
        specification = request["analysis_specification"]
        clarification = request["clarification_answer"]
        revision = request["revision_instruction"]
        answers = request["answers"]
        if analysis_plan is not None and not isinstance(analysis_plan, dict):
            raise ValueError("analysis_plan must be an object")
        if specification is not None and not isinstance(specification, dict):
            raise ValueError("analysis_specification must be an object")
        if clarification is not None and (
            not isinstance(clarification, str)
            or not clarification.strip()
            or len(clarification) > 800
        ):
            raise ValueError("clarification_answer must be short text")
        if revision is not None and (
            not isinstance(revision, str)
            or not revision.strip()
            or len(revision) > 500
        ):
            raise ValueError("revision_instruction must be short text")
        if not isinstance(answers, dict) or any(
            key not in {"audience", "comparison", "business_goal"}
            or not isinstance(value, str)
            or not value.strip()
            or len(value) > 200
            for key, value in answers.items()
        ):
            raise ValueError("answers must contain only short supported text fields")

    def _validate_endpoint_request(self, request: dict) -> None:
        if self.path == "/api/consult":
            self._validate_consultation(request)
        elif self.path == "/api/report":
            if not isinstance(request["build_revision"], str) or not re.fullmatch(
                r"build-[0-9a-f]{12}", request["build_revision"]
            ):
                raise ValueError("build_revision is invalid")
        elif self.path == "/api/plan":
            self._validate_plan(request)
        elif self.path == "/api/dashboard":
            self._validate_dashboard(request)
        elif request["analysis_specification"] is None:
            raise ValueError(
                "AIが作成した分析仕様を選択してからbuildしてください。"
            )
        else:
            confirmed = self.planner.confirm_analysis_specification(
                request["analysis_specification"]
            )
            self.analysis_section_for_specification(
                request["question"], confirmed, request["profile"]
            )
            request["analysis_specification"] = confirmed

    def _validate_consultation(self, request: dict) -> None:
        history = request["history"]
        if not isinstance(history, list) or len(history) > 8:
            raise ValueError("history must contain at most 8 turns")
        total_history_chars = 0
        for index, turn in enumerate(history):
            expected_role = "user" if index % 2 == 0 else "assistant"
            if (
                not isinstance(turn, dict)
                or set(turn) != {"role", "content"}
                or turn.get("role") != expected_role
                or not isinstance(turn.get("content"), str)
                or not turn["content"].strip()
                or len(turn["content"]) > 800
            ):
                raise ValueError("history contains an invalid turn")
            total_history_chars += len(turn["content"])
        if total_history_chars > 3000:
            raise ValueError("history is too large")
        question = request["question"]
        if not question.strip() or len(question) > self.max_question_chars:
            raise ValueError("consultation question is invalid")

    def _validate_plan(self, request: dict) -> None:
        if request["profile"] != "ga4":
            raise ValueError("planning mode currently supports only ga4")
        plan = request["analysis_plan"]
        instruction = request["revision_instruction"]
        if (plan is None) != (instruction is None):
            raise ValueError(
                "analysis_plan and revision_instruction must be provided together"
            )
        self.period_for_question(request["question"])
        if plan is not None:
            self.planner.confirm_dashboard_plan(plan)

    def _validate_dashboard(self, request: dict) -> None:
        if request["profile"] != "ga4":
            raise ValueError("dashboard mode currently supports only ga4")
        plan = request["analysis_plan"]
        if plan is None:
            raise ValueError("AIが作成した分析仕様を確定してからbuildしてください。")
        confirmed = self.planner.confirm_dashboard_plan(plan)
        self.dashboard_sections_for_plan(request["question"], confirmed)

    def _validation_errors(self) -> tuple[type[BaseException], ...]:
        return (
            ValueError,
            json.JSONDecodeError,
            self.live_error_type,
            self.planner.PlannerError,
        )
