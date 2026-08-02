#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("環境変数 DATABASE_URL が設定されていません。");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString });

function toTextResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function toErrorResult(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

const server = new McpServer({
  name: "postgres-mcp-server",
  version: "1.0.0",
});

server.registerTool(
  "query",
  {
    title: "SQLクエリ実行（読み取り専用）",
    description:
      "SELECT文のみを読み取り専用トランザクションで実行し、結果を返します。書き込みを伴うクエリは拒否されます。",
    inputSchema: {
      sql: z.string().describe("実行するSELECT文"),
      params: z.array(z.unknown()).optional().describe("プレースホルダ($1, $2, ...)に渡すパラメータ"),
    },
  },
  async ({ sql, params }) => {
    const trimmed = sql.trim().replace(/;+\s*$/, "");
    if (!/^(select|with)\s/i.test(trimmed)) {
      return toErrorResult("query ツールでは SELECT 文（または SELECT を含む WITH 句）のみ実行できます。書き込みには execute ツールを使ってください。");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      const result = await client.query(trimmed, params ?? []);
      await client.query("COMMIT");
      return toTextResult({ rowCount: result.rowCount, rows: result.rows });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      return toErrorResult(`クエリ実行エラー: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
);

server.registerTool(
  "execute",
  {
    title: "SQLクエリ実行（書き込み可）",
    description:
      "INSERT / UPDATE / DELETE などの書き込みを含む任意のSQL文を実行します。取り消せない変更が発生する可能性があるため注意してください。",
    inputSchema: {
      sql: z.string().describe("実行するSQL文"),
      params: z.array(z.unknown()).optional().describe("プレースホルダ($1, $2, ...)に渡すパラメータ"),
    },
  },
  async ({ sql, params }) => {
    const client = await pool.connect();
    try {
      const result = await client.query(sql, params ?? []);
      return toTextResult({ rowCount: result.rowCount, rows: result.rows });
    } catch (err) {
      return toErrorResult(`クエリ実行エラー: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
);

server.registerTool(
  "list_tables",
  {
    title: "テーブル一覧取得",
    description: "指定スキーマ（デフォルト: public）内のテーブル一覧を取得します。",
    inputSchema: {
      schema: z.string().default("public").describe("対象スキーマ名"),
    },
  },
  async ({ schema }) => {
    try {
      const result = await pool.query(
        `SELECT table_name, table_type
         FROM information_schema.tables
         WHERE table_schema = $1
         ORDER BY table_name`,
        [schema]
      );
      return toTextResult(result.rows);
    } catch (err) {
      return toErrorResult(`取得エラー: ${(err as Error).message}`);
    }
  }
);

server.registerTool(
  "describe_table",
  {
    title: "テーブルスキーマ取得",
    description: "指定テーブルのカラム名・型・NULL許可などの情報を取得します。",
    inputSchema: {
      table: z.string().describe("テーブル名"),
      schema: z.string().default("public").describe("対象スキーマ名"),
    },
  },
  async ({ table, schema }) => {
    try {
      const result = await pool.query(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [schema, table]
      );
      if (result.rowCount === 0) {
        return toErrorResult(`テーブルが見つかりません: ${schema}.${table}`);
      }
      return toTextResult(result.rows);
    } catch (err) {
      return toErrorResult(`取得エラー: ${(err as Error).message}`);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Postgres MCP server が起動しました (stdio)");
}

main().catch((err) => {
  console.error("サーバー起動エラー:", err);
  process.exit(1);
});
