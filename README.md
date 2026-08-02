# postgres-mcp-server

PostgreSQL用のシンプルなMCP（Model Context Protocol）サーバーです。

## 提供ツール

- `query` — SELECT文のみを読み取り専用トランザクションで実行
- `execute` — INSERT/UPDATE/DELETEなど書き込みを含む任意のSQLを実行（注意して使用してください）
- `list_tables` — 指定スキーマ（デフォルト: public）のテーブル一覧を取得
- `describe_table` — 指定テーブルのカラム情報を取得

## セットアップ

```bash
npm install
npm run build
```

## 接続先DBの指定

環境変数 `DATABASE_URL` にPostgreSQLの接続文字列を設定します。

```
postgresql://user:password@host:5432/dbname
```

## Claude Codeへの登録

```bash
claude mcp add postgres -e DATABASE_URL="postgresql://user:password@host:5432/dbname" -- node /Users/juth5/Desktop/mcp/dist/index.js
```

登録後、`claude mcp list` で認識されているか確認できます。

## 注意事項

- `execute` ツールは書き込み・削除を伴うため、本番DBに対しては権限を絞ったDBユーザーで接続することを推奨します。
- `query` ツールは `BEGIN TRANSACTION READ ONLY` 内で実行され、SELECT文以外は拒否されます。
