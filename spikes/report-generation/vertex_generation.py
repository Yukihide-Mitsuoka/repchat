"""Safe boundary for one Vertex AI content-generation request."""

from __future__ import annotations


class VertexRequestError(ValueError):
    """A bounded provider failure that is safe to display in the local UI."""


_SAFE_STATUSES = frozenset(
    {
        "INVALID_ARGUMENT",
        "UNAUTHENTICATED",
        "PERMISSION_DENIED",
        "NOT_FOUND",
        "RESOURCE_EXHAUSTED",
        "DEADLINE_EXCEEDED",
        "INTERNAL",
        "UNAVAILABLE",
    }
)


def _diagnostic(error: Exception) -> tuple[int | None, str | None] | None:
    code = getattr(error, "code", None)
    if isinstance(code, bool) or not isinstance(code, int) or not 100 <= code <= 599:
        code = None
    status = getattr(error, "status", None)
    if status not in _SAFE_STATUSES:
        status = None
    if code is None and status is None:
        return None
    return code, status


def _label(code: int | None, status: str | None) -> str:
    return " ".join(value for value in (str(code) if code else None, status) if value)


def _safe_message(code: int | None, status: str | None) -> str:
    label = _label(code, status)
    suffix = "今回の処理は自動再実行していません。"
    if code == 400 or status == "INVALID_ARGUMENT":
        lead = "Vertex AIが生成リクエストを受理できませんでした"
        guidance = "入力または生成設定を確認してください。"
    elif code == 401 or status == "UNAUTHENTICATED":
        lead = "Vertex AIの認証に失敗しました"
        guidance = "Google Cloudの認証状態を確認してください。"
    elif code == 403 or status == "PERMISSION_DENIED":
        lead = "Vertex AIの呼出し権限がありません"
        guidance = "対象プロジェクトのAPIとIAM権限を確認してください。"
    elif code == 404 or status == "NOT_FOUND":
        lead = "Vertex AIのモデルまたはエンドポイントが見つかりません"
        guidance = "設定したモデルとリージョンを確認してください。"
    elif code == 429 or status == "RESOURCE_EXHAUSTED":
        lead = "Vertex AIの割り当て上限または処理容量を超えました"
        guidance = "割り当てと利用状況を確認してから再度操作してください。"
    elif (code is not None and code >= 500) or status in {
        "INTERNAL",
        "UNAVAILABLE",
        "DEADLINE_EXCEEDED",
    }:
        lead = "Vertex AIで一時的なサービスエラーが発生しました"
        guidance = "サービス状態を確認してから再度操作してください。"
    else:
        lead = "Vertex AIリクエストに失敗しました"
        guidance = "対象プロジェクトと生成設定を確認してください。"
    detail = f"（{label}）" if label else ""
    return f"{lead}{detail}。{guidance}{suffix}"


def generate_content(client, **kwargs):
    """Execute exactly once and translate only bounded provider diagnostics."""
    try:
        return client.models.generate_content(**kwargs)
    except Exception as error:
        diagnostic = _diagnostic(error)
        if diagnostic is None:
            raise
        raise VertexRequestError(_safe_message(*diagnostic)) from None
