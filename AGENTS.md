<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->


# AI Bar Master 開発規約

- 実コードは React / TypeScript / TanStack Start / Vite。通常の静的Vite SPAとは扱わない。
- Lovable管理ブロックと既存Git履歴を保持する。生成物 `src/routeTree.gen.ts` を手編集しない。
- `functions/api` はCloudflare Pages Functionsの入口。業務処理は `server/`、共通DTOは `shared/` に置く。
- `functions/` に補助ファイルを置いて意図しないAPIルートを増やさない。
- APIの返却は message / emotion / cocktailCard。感情タグは shared/chat.ts を正とする。
- 生成返答は80〜120 Unicodeコードポイント、カルテは50文字以内。入力エラー文は対象外。
- カルテは列挙済みの相談カテゴリ・気分のみ保存する。実名、住所、連絡先、生の会話ログを保存・ログ出力しない。
- ユーザー識別子は認証済みサーバーコンテキストからのみ受け取る。bodyや未検証ヘッダーのIDを信頼しない。
- D1はバインドパラメータを使う。schema.sql は新規DB用。既存DBには追加マイグレーションを作りデータを保持する。
- OpenAIキーはサーバーSecret。VITE_変数、ブラウザ、Gitに含めない。
- 429/5xx、タイムアウト、不正JSON、拒否応答で追加の自動課金リトライを行わず、同じDTOでフォールバックする。
- 営業時間・料金判定を追加する際はJST境界（19/23/4時）と日次/月次/無料通算上限の単体テストを追加する。
- 検証: npm test / npx tsc --noEmit / npm run lint / npm run build。既存失敗と変更由来の失敗を分けて報告する。
- 現段階で未実装の認証、利用時間の計測・上限予約、Stripe、危機判定・セッション終了を実装済みと説明しない。
- デプロイ構成の確定前に本番公開しない。設計上の差異・残作業は docs/backend-handoff.md に記録する。
