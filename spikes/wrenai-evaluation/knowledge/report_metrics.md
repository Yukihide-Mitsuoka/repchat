# 指標定義

LOG-0065/0066 で「定義しないと数値が実行ごとに揺れる」ことを実測した2件を含む。
ここに定義がある語は、自分で解釈し直さないこと。

## 粒度

- セッション: `CONCAT(user_pseudo_id, '-', CAST(ga_session_id AS STRING))` の異なり数
- ユーザー: `user_pseudo_id` の異なり数

## 指標

| 指標 | 定義 | 注記 |
|---|---|---|
| セッション数 | `COUNT(DISTINCT CONCAT(user_pseudo_id, '-', CAST(ga_session_id AS STRING)))` | |
| ユーザー数 | `COUNT(DISTINCT user_pseudo_id)` | |
| ページビュー数 | `COUNTIF(event_name = 'page_view')` | 行数ではない |
| 購入件数 | `COUNT(DISTINCT transaction_id)`（`event_name = 'purchase'` の行） | **行数で数えない。** GA4 は同一取引で purchase を重複発火する |
| 購入金額 | `SUM(purchase_revenue)`（`event_name = 'purchase'` の行） | items を展開すると二重計上になる |
| 新規セッション | `ga_session_number = 1` のセッション | **first_visit イベントでは判定しない。** 両者は一致しない |
| リピートセッション | 新規セッションの補集合 | |
| エンゲージメント時間 | `SUM(engagement_time_msec)` | ミリ秒。秒で出すなら 1000 で割る |
