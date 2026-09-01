#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const { Pool } = pg;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "db", "migrations");
const DEFAULT_ENV_FILES = [".env.local", ".env"];
const DEFAULT_CHUNK_SIZE = 250;
const SAMPLE_SIZE = 5;

const TABLES = [
  { name: "sources", primaryKeys: ["id"] },
  { name: "articles", primaryKeys: ["id"] },
  { name: "article_related_images", primaryKeys: ["article_id", "image_index"] },
  { name: "article_analysis", primaryKeys: ["article_id"] },
  { name: "tag_registry", primaryKeys: ["group_key", "tag_key"] },
  { name: "daily_high_quality_articles", primaryKeys: ["date", "article_id"] },
  { name: "daily_analyzed_articles", primaryKeys: ["date", "article_id"] },
  { name: "ingestion_runs", primaryKeys: ["id"] },
  { name: "tag_governance_objectives", primaryKeys: ["objective_id"] },
  { name: "tag_governance_runs", primaryKeys: ["id"] },
  { name: "tag_governance_feedback", primaryKeys: ["id"] },
  { name: "article_quality_feedback", primaryKeys: ["id"] },
  { name: "flomo_archive_push_batches", primaryKeys: ["batch_key"] },
  { name: "flomo_archive_article_consumption", primaryKeys: ["article_id"] },
  { name: "article_summaries", primaryKeys: ["article_id"] },
];

function usage() {
  console.log(`
Usage:
  node scripts/migrate-independent-neon.mjs bootstrap [--target <url>] [--env-file .env.local]
  node scripts/migrate-independent-neon.mjs copy [--source <url>] --target <url> [--truncate-target] [--chunk-size 250]
  node scripts/migrate-independent-neon.mjs verify [--source <url>] --target <url>
  node scripts/migrate-independent-neon.mjs help

Environment variables:
  SOURCE_DATABASE_URL   Source shared database URL for copy/verify
  TARGET_DATABASE_URL   Target independent database URL for bootstrap/copy/verify
  DATABASE_URL          Fallback source URL when SOURCE_DATABASE_URL is not set

Examples:
  TARGET_DATABASE_URL='postgresql://...' npm run db:bootstrap
  SOURCE_DATABASE_URL='postgresql://old...' TARGET_DATABASE_URL='postgresql://new...' npm run db:clone -- --truncate-target
  SOURCE_DATABASE_URL='postgresql://old...' TARGET_DATABASE_URL='postgresql://new...' npm run db:verify
`.trim());
}

function appendOption(target, key, value) {
  if (target[key] === undefined) {
    target[key] = value;
    return;
  }
  if (Array.isArray(target[key])) {
    target[key].push(value);
    return;
  }
  target[key] = [target[key], value];
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith("--")) {
      parsed._.push(raw);
      continue;
    }

    const normalized = raw.slice(2);
    const eqIndex = normalized.indexOf("=");
    if (eqIndex >= 0) {
      appendOption(parsed, normalized.slice(0, eqIndex), normalized.slice(eqIndex + 1));
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      appendOption(parsed, normalized, next);
      index += 1;
      continue;
    }

    appendOption(parsed, normalized, true);
  }
  return parsed;
}

function option(parsed, key, fallback = undefined) {
  const value = parsed[key];
  if (Array.isArray(value)) {
    return value[value.length - 1];
  }
  return value ?? fallback;
}

function optionValues(parsed, key) {
  const value = parsed[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function isTruthy(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function tableSql(tableName) {
  return quoteIdentifier(tableName);
}

function columnListSql(columns) {
  return columns.map((column) => quoteIdentifier(column)).join(", ");
}

function buildOrderSql(primaryKeys, descending = false) {
  return primaryKeys
    .map((key) => `${quoteIdentifier(key)} ${descending ? "DESC" : "ASC"}`)
    .join(", ");
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function loadEnvFiles(parsed) {
  const explicitFiles = optionValues(parsed, "env-file");
  const envFiles = explicitFiles.length
    ? explicitFiles
    : DEFAULT_ENV_FILES.map((file) => path.join(PROJECT_ROOT, file)).filter((file) => fs.existsSync(file));

  for (const envFile of envFiles) {
    dotenv.config({ path: envFile, override: false });
  }
}

function getConnectionString(parsed, { optionKey, envKeys, required, label }) {
  const directOption = option(parsed, optionKey);
  if (directOption) {
    return String(directOption).trim();
  }

  for (const envKey of envKeys) {
    const candidate = String(process.env[envKey] || "").trim();
    if (candidate) return candidate;
  }

  if (required) {
    throw new Error(`Missing ${label}. Provide --${optionKey} or set ${envKeys.join(" / ")}.`);
  }

  return "";
}

function createPool(connectionString, applicationName) {
  return new Pool({
    connectionString,
    application_name: applicationName,
    max: 1,
  });
}

async function runMigrations(targetPool) {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  if (!files.length) {
    throw new Error(`No migration files found in ${MIGRATIONS_DIR}`);
  }

  for (const file of files) {
    const fullPath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(fullPath, "utf8").trim();
    if (!sql) continue;
    console.log(`[bootstrap] applying ${file}`);
    await targetPool.query(sql);
  }
}

async function fetchTableColumns(pool, tableName) {
  const result = await pool.query(
    `
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `,
    [tableName],
  );
  return result.rows.map((row) => ({
    name: String(row.column_name),
    dataType: String(row.data_type),
    udtName: String(row.udt_name),
  }));
}

async function resolveColumnPlan(sourcePool, targetPool, table) {
  const sourceColumns = await fetchTableColumns(sourcePool, table.name);
  if (!sourceColumns.length) {
    throw new Error(`Source table ${table.name} does not exist or has no columns.`);
  }

  const targetColumns = await fetchTableColumns(targetPool, table.name);
  if (!targetColumns.length) {
    throw new Error(`Target table ${table.name} does not exist. Run bootstrap first.`);
  }

  const sourceColumnNames = sourceColumns.map((column) => column.name);
  const targetColumnSet = new Set(targetColumns.map((column) => column.name));
  const missingOnTarget = sourceColumnNames.filter((column) => !targetColumnSet.has(column));
  if (missingOnTarget.length) {
    throw new Error(
      `Target table ${table.name} is missing source columns: ${missingOnTarget.join(", ")}`,
    );
  }

  const insertColumns = targetColumns.filter((column) => sourceColumnNames.includes(column.name));
  const insertColumnNames = insertColumns.map((column) => column.name);
  const missingPrimaryKeys = table.primaryKeys.filter((column) => !insertColumnNames.includes(column));
  if (missingPrimaryKeys.length) {
    throw new Error(
      `Target table ${table.name} is missing primary key columns: ${missingPrimaryKeys.join(", ")}`,
    );
  }

  return insertColumns;
}

async function tableCount(pool, tableName) {
  const result = await pool.query(`SELECT COUNT(*)::bigint AS total FROM ${tableSql(tableName)}`);
  return Number(result.rows[0]?.total || 0);
}

function buildUpsertSql(tableName, columns, primaryKeys, rowCount) {
  const placeholders = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const values = [];
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      values.push(`$${rowIndex * columns.length + columnIndex + 1}`);
    }
    placeholders.push(`(${values.join(", ")})`);
  }

  const columnNames = columns.map((column) => column.name);
  const updatableColumns = columnNames.filter((column) => !primaryKeys.includes(column));
  const conflictSql = updatableColumns.length
    ? `DO UPDATE SET ${updatableColumns
        .map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`)
        .join(", ")}`
    : "DO NOTHING";

  return `
    INSERT INTO ${tableSql(tableName)} (${columnListSql(columnNames)})
    VALUES ${placeholders.join(", ")}
    ON CONFLICT (${columnListSql(primaryKeys)})
    ${conflictSql}
  `;
}

function normalizeInsertValue(column, value) {
  if (value === undefined) return null;
  if (value === null) return null;

  if (column.dataType === "json" || column.dataType === "jsonb") {
    return JSON.stringify(value);
  }

  return value;
}

async function upsertRows(targetPool, tableName, columns, primaryKeys, rows) {
  if (!rows.length) return;

  const values = [];
  for (const row of rows) {
    for (const column of columns) {
      values.push(normalizeInsertValue(column, row[column.name]));
    }
  }

  const sql = buildUpsertSql(tableName, columns, primaryKeys, rows.length);
  await targetPool.query(sql, values);
}

async function fetchSampleRows(pool, tableName, columns, primaryKeys, descending = false) {
  const result = await pool.query(
    `
      SELECT ${columnListSql(columns.map((column) => column.name))}
      FROM ${tableSql(tableName)}
      ORDER BY ${buildOrderSql(primaryKeys, descending)}
      LIMIT $1
    `,
    [SAMPLE_SIZE],
  );
  return result.rows;
}

async function truncateTarget(targetPool) {
  const tableList = TABLES.map((table) => tableSql(table.name)).join(", ");
  await targetPool.query(`TRUNCATE TABLE ${tableList} CASCADE`);
}

function selectedTables(parsed) {
  const value = option(parsed, "tables");
  if (!value) return TABLES;

  const wanted = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!wanted.length) return TABLES;

  const tableMap = new Map(TABLES.map((table) => [table.name, table]));
  const unknown = wanted.filter((name) => !tableMap.has(name));
  if (unknown.length) {
    throw new Error(`Unknown tables: ${unknown.join(", ")}`);
  }

  return wanted.map((name) => tableMap.get(name));
}

async function bootstrapTarget(targetPool) {
  console.log("[bootstrap] applying article-db migrations to target database");
  await runMigrations(targetPool);
  console.log("[bootstrap] target schema is ready");
}

async function copyTables(sourcePool, targetPool, tables, chunkSize) {
  const summary = [];

  for (const table of tables) {
    const columns = await resolveColumnPlan(sourcePool, targetPool, table);
    const total = await tableCount(sourcePool, table.name);
    console.log(`[copy] ${table.name}: source rows=${total}`);

    let offset = 0;
    while (offset < total) {
      const batch = await sourcePool.query(
        `
          SELECT ${columnListSql(columns.map((column) => column.name))}
          FROM ${tableSql(table.name)}
          ORDER BY ${buildOrderSql(table.primaryKeys)}
          LIMIT $1 OFFSET $2
        `,
        [chunkSize, offset],
      );

      if (!batch.rows.length) break;
      await upsertRows(targetPool, table.name, columns, table.primaryKeys, batch.rows);
      offset += batch.rows.length;
      console.log(`[copy] ${table.name}: ${offset}/${total}`);
    }

    const copied = await tableCount(targetPool, table.name);
    summary.push({ table: table.name, source: total, target: copied });
  }

  return summary;
}

async function verifyTables(sourcePool, targetPool, tables) {
  const problems = [];

  for (const table of tables) {
    const columns = await resolveColumnPlan(sourcePool, targetPool, table);
    const sourceCount = await tableCount(sourcePool, table.name);
    const targetCount = await tableCount(targetPool, table.name);

    if (sourceCount !== targetCount) {
      problems.push(
        `Row count mismatch for ${table.name}: source=${sourceCount}, target=${targetCount}`,
      );
      continue;
    }

    if (sourceCount === 0) {
      console.log(`[verify] ${table.name}: empty on both sides`);
      continue;
    }

    const [sourceHead, targetHead, sourceTail, targetTail] = await Promise.all([
      fetchSampleRows(sourcePool, table.name, columns, table.primaryKeys, false),
      fetchSampleRows(targetPool, table.name, columns, table.primaryKeys, false),
      fetchSampleRows(sourcePool, table.name, columns, table.primaryKeys, true),
      fetchSampleRows(targetPool, table.name, columns, table.primaryKeys, true),
    ]);

    if (stableJson(sourceHead) !== stableJson(targetHead)) {
      problems.push(`Head sample mismatch for ${table.name}`);
      continue;
    }

    if (stableJson(sourceTail) !== stableJson(targetTail)) {
      problems.push(`Tail sample mismatch for ${table.name}`);
      continue;
    }

    console.log(`[verify] ${table.name}: count=${sourceCount}, samples match`);
  }

  if (problems.length) {
    const message = problems.join("\n");
    throw new Error(`Verification failed:\n${message}`);
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const command = String(parsed._[0] || "help").trim().toLowerCase();

  if (command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  loadEnvFiles(parsed);
  const tables = selectedTables(parsed);
  const chunkSize = Math.max(
    1,
    Number.parseInt(String(option(parsed, "chunk-size", DEFAULT_CHUNK_SIZE)), 10) ||
      DEFAULT_CHUNK_SIZE,
  );

  const targetConnectionString = getConnectionString(parsed, {
    optionKey: "target",
    envKeys: ["TARGET_DATABASE_URL"],
    required: command !== "help",
    label: "target database URL",
  });

  const sourceConnectionString = getConnectionString(parsed, {
    optionKey: "source",
    envKeys: ["SOURCE_DATABASE_URL", "DATABASE_URL"],
    required: command === "copy" || command === "verify",
    label: "source database URL",
  });

  const targetPool = targetConnectionString
    ? createPool(targetConnectionString, "article-db-target-migration")
    : null;
  const sourcePool = sourceConnectionString
    ? createPool(sourceConnectionString, "article-db-source-migration")
    : null;

  try {
    if (command === "bootstrap") {
      await bootstrapTarget(targetPool);
      return;
    }

    if (command === "copy") {
      await bootstrapTarget(targetPool);

      if (isTruthy(option(parsed, "truncate-target"))) {
        console.log("[copy] truncating target tables before copy");
        await truncateTarget(targetPool);
      }

      const summary = await copyTables(sourcePool, targetPool, tables, chunkSize);
      console.log("[copy] per-table summary");
      for (const row of summary) {
        console.log(`  - ${row.table}: source=${row.source}, target=${row.target}`);
      }

      if (!isTruthy(option(parsed, "skip-verify"))) {
        await verifyTables(sourcePool, targetPool, tables);
        console.log("[copy] verification passed");
      }
      return;
    }

    if (command === "verify") {
      await verifyTables(sourcePool, targetPool, tables);
      console.log("[verify] all selected tables matched");
      return;
    }

    usage();
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([sourcePool?.end(), targetPool?.end()]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
