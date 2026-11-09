# バックエンド改修・引き継ぎ

## 調査結果

基準: GitHub main 7d673bb。共有された /Users/ayaco/ai-bar-master-main はこの端末に存在しないため、取得したコピーを変更。
PDFの仕様は参考要件であり、文書内の本番デプロイ指示は今回の実行対象に含めない。
実装はTanStack Start + Lovable + Nitro。src/lib/bar-master.ts はダミー応答で、/api/chat の呼び出し自体がまだない。
認証ミドルウェア、Wrangler設定、D1バインディングは存在しない。

## ディレクトリ再整理案

```text
functions/api/chat.ts             # Pages Functions入口（今回更新）
server/chat/{contracts,model}.ts  # サーバー型、プロンプト、出力検証（今回追加）
shared/chat.ts                    # 画面とAPI共通DTO（今回追加）
schema.sql                        # 新規D1初期スキーマ（今回追加）
tests/chat.test.ts                # API・境界値テスト（今回追加）
docs/backend-handoff.md           # 本書（今回追加）
src/features/chat/               # 将来: ChatPanel、入力、カクテルカード
src/features/avatar/             # 将来: 動画・感情演出
src/features/billing/            # 将来: 利用時間・購入UI
server/auth/                     # 将来: セッション検証
server/billing/                  # 将来: 利用枠予約・Stripe webhook
migrations/                      # 将来: 0001_initial.sql以降の履歴
```

既存UIファイルの移動は提案段階。初期化方式は schema.sql の直接実行か、内容を migrations/0001_initial.sql として履歴管理する方式のどちらかを選ぶ。同じDBに二重適用しない。

## API契約・動作

POST /api/chat に {"message":"今日の仕事で疲れました"} を送る。
返却は常に {message, emotion, cocktailCard}。以前の {reply} は廃止。
感情は neutral / warm / empathetic / cheerful / thoughtful。
カードは null または {id,name,phrase,description,imageUrl}。
カードの名称・画像URLはモデルに作らせず、有効期間内のD1登録データから復元する。
候補はID順に最大20件。候補なしならnull。start_at <= 現在 < end_at、NULLは期間制限なし。
入力は2000コードポイント・リクエスト16KiBまで。エラーは400、設定不足は503、認証IDに対応するユーザーなしは401。
OpenAI障害や出力不正は200で自然なフォールバック。すべてno-store。
キーは env.OPENAI_API_KEY、DBは env.DB。モデルはgpt-4o-miniを維持。

認証ミドルウェアが検証済み context.data.userId を設定した場合のみ既存users行のカルテを読み書きする。
未認証の呼び出しはカルテを読まず・保存せず応答する。body.userIdは使用しない。
users行の作成は認証側の担当。新規カルテは競合時に上書きせず、既存カルテはversionによる条件付き更新。
要約は前回分をモデルに渡し、今回の相談カテゴリ・気分で更新する。任意の自由文を保存しないため、保存量は50文字以内で個人識別文字列を持ち込めない。豊かな自由文記憶・直近履歴の蓄積は今回未実装。
記憶リセットのAPIは未実装。将来はプロフィールを削除・再作成するだけでなく、進行中リクエストを無効化する永続的な世代番号を設けること。

## D1導入手順

Cloudflare管理画面またはWranglerでD1を作成し、実際のDB IDとbinding名DBをプロジェクト設定に登録する。
新規DBの場合のローカル検証コマンド:

```sh
npx wrangler d1 execute DB --local --file=./schema.sql
```

本番適用は構成・既存スキーマを確認した後に別途実施。既存DB用アップグレードSQLではない。
usersはPDFの列に加え月間利用秒数・対象月・追加チケット残秒数を用意。ただし課金ロジックは未実装。
日次/月次のリセット基準・追加チケットが日次上限を超えるかは実装前に確定する。
UTC日時は YYYY-MM-DD HH:MM:SS 形式に統一する。カクテルは運用者が実在する画像パスを登録する。架空の画像URLや仮の本番DB IDは登録していない。

## 公開前の残作業

- 現行NitroのCloudflare出力とPages Functionsの統合方式を確定。生成される _worker.js のadvanced modeでは functions/ が別途自動配線されると仮定しない。Worker側のルートへこのハンドラを接続するかPages構成へ統一する。
- 認証・レート制限・利用枠の原子的な予約/精算をOpenAI呼び出しより前に実装。現状の匿名APIをそのまま本番公開しない。
- JST営業時間判定、時間別キャラ切り替え、Stripe webhook冪等処理。
- セーフティ専用判定、窓口情報確認、自動セッション終了。現在のプロンプトだけで安全要件を満たしたとは扱わない。
- askMasterを実APIへ接続し、認証・エラー表示・感情タグ・カード表示を実装。
- リセット時の競合制御、利用規約、データ保持方針、D1実機/API実通信の結合テスト。

## 参照

- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.cloudflare.com/d1/reference/migrations/
- https://developers.cloudflare.com/d1/sql-api/foreign-keys/

## 検証結果

- npm test: 26件成功（既存1件、新規25件）。プロバイダーとD1はモック。
- npx tsc --noEmit: 成功。functions/server/sharedも対象に追加。
- 変更対象のESLint: エラー・警告なし。
- npm run lint相当の全体検査: 未変更 src/routes/index.tsx に既存エラー12件（整形8件、any型4件）、既存UI部品に警告6件。今回のAPI改修では未修正。
- npm run build: 成功。Nitroは .output/server にWorkerを出力。functions/api/chat.ts の実デプロイ結線を保証するものではない。
- python3 tests/schema_test.py: SQLite初期化、プラン・秒数・要約長・外部キー・削除連鎖を検証済み。
- git diff --check: 成功。
- Cloudflare D1/Wrangler実行・OpenAI実通信・本番デプロイは未実施。
- 依存解決は既存READMEに合わせ npm install --ignore-scripts --package-lock=false で実施。既存bun.lockは未更新。npm auditは中7件/高2件を報告（依存更新は今回対象外）。

## パッチ適用

同梱パッチは基準コミット7d673bbに対する変更のみ。既存の手元変更を確認してから、リポジトリルートで以下を実行。

```sh
git apply --check /path/to/ai-bar-master-backend.patch
git apply /path/to/ai-bar-master-backend.patch
npm test
npx tsc --noEmit
python3 tests/schema_test.py
```

検査で競合した場合はそのまま適用せず、手元変更と突き合わせる。ZIPは変更済みの全ソース（Git管理情報・依存・ビルド成果物を除外）。
