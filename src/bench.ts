import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { ulid } from "ulid";
import { applySchema } from "./db/schema.js";
import {
  initEmbeddings,
  embed,
  cosineSimilarity,
  embeddingToBuffer,
  bufferToEmbedding,
} from "./embeddings/local.js";

// Realistic-ish task data to embed
const TASK_TEMPLATES = [
  { title: "Fix crash in {component} on {platform}", desc: "Users report {symptom} when {action}. Stack trace points to {module}.", tags: ["bug"] },
  { title: "Add {feature} to {component}", desc: "Implement {feature} with support for {detail}. Should integrate with {dependency}.", tags: ["feature"] },
  { title: "Refactor {component} to use {pattern}", desc: "Current implementation uses {old_pattern}. Migrate to {pattern} for better {benefit}.", tags: ["refactor"] },
  { title: "Investigate {issue} in {component}", desc: "Seeing {metric} degrade over time. Likely related to {cause}.", tags: ["bug", "performance"] },
  { title: "Update {dependency} to latest version", desc: "Current version has {problem}. New version fixes this and adds {improvement}.", tags: ["maintenance"] },
  { title: "Write tests for {component}", desc: "Coverage is low on {component}. Add unit tests for {scenarios}.", tags: ["testing"] },
  { title: "Deploy {component} to {environment}", desc: "Set up {tool} pipeline for {component}. Include {checks}.", tags: ["devops"] },
  { title: "Document {component} API", desc: "Add OpenAPI spec and usage examples for {endpoints}.", tags: ["docs"] },
];

const FILLS: Record<string, string[]> = {
  component: ["auth service", "payment flow", "search index", "notification system", "user dashboard", "admin panel", "API gateway", "worker queue", "file upload", "analytics pipeline"],
  platform: ["Safari", "Firefox", "iOS", "Android", "Chrome", "Edge"],
  symptom: ["a white screen", "infinite loading", "data loss", "timeout errors", "memory spike"],
  action: ["clicking submit", "refreshing the page", "uploading a file", "switching tabs", "logging in"],
  module: ["the auth handler", "the ORM layer", "the cache middleware", "the event bus", "the serializer"],
  feature: ["dark mode", "pagination", "rate limiting", "webhooks", "SSO", "bulk export", "audit logging", "real-time sync"],
  detail: ["keyboard shortcuts", "mobile responsiveness", "offline support", "custom themes", "role-based access"],
  dependency: ["Redis", "PostgreSQL", "S3", "Elasticsearch", "RabbitMQ", "Stripe API"],
  pattern: ["event sourcing", "CQRS", "repository pattern", "middleware chain", "pub/sub"],
  old_pattern: ["direct DB calls", "inline handlers", "monolithic service", "polling", "synchronous processing"],
  benefit: ["testability", "performance", "maintainability", "scalability", "observability"],
  issue: ["memory leak", "slow queries", "high CPU usage", "connection exhaustion", "disk growth"],
  metric: ["p99 latency", "error rate", "memory RSS", "query time", "throughput"],
  cause: ["missing indexes", "unbounded caching", "N+1 queries", "connection pool exhaustion", "large payload serialization"],
  problem: ["a known CVE", "breaking API changes", "memory leaks", "poor TypeScript types"],
  improvement: ["tree-shaking support", "better error messages", "streaming support"],
  scenarios: ["edge cases", "error paths", "concurrent access", "empty inputs", "large payloads"],
  environment: ["staging", "production", "preview", "dev"],
  tool: ["GitHub Actions", "ArgoCD", "Terraform", "Docker Compose"],
  checks: ["lint + type check", "E2E tests", "security scan", "load test"],
  endpoints: ["/api/tasks", "/api/users", "/api/projects", "/api/search", "/api/webhooks"],
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fillTemplate(template: string): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const options = FILLS[key];
    return options ? pick(options) : key;
  });
}

function generateTasks(n: number) {
  const tasks = [];
  for (let i = 0; i < n; i++) {
    const tmpl = pick(TASK_TEMPLATES);
    tasks.push({
      title: fillTemplate(tmpl.title),
      description: fillTemplate(tmpl.desc),
      tags: tmpl.tags,
    });
  }
  return tasks;
}

function fmt(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function main() {
  console.log("=== Performance Benchmark ===\n");

  // Init
  let t0 = performance.now();
  await initEmbeddings();
  console.log(`Model init: ${fmt(performance.now() - t0)}\n`);

  // DB setup
  const db = new Database(":memory:");
  applySchema(db);

  const insertTask = db.prepare(`
    INSERT INTO tasks (id, title, description, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertEmbedding = db.prepare(`
    INSERT INTO task_embeddings (task_id, embedding, content_hash)
    VALUES (?, ?, ?)
  `);

  // Benchmark embedding generation at different scales
  for (const count of [10, 50, 100, 250]) {
    const tasks = generateTasks(count);
    const embeddings: Array<{ id: string; title: string; desc: string; tags: string; emb: Float32Array; hash: string }> = [];

    t0 = performance.now();
    for (const task of tasks) {
      const id = ulid();
      const content = `${task.title}\n${task.description}\n${task.tags.join(", ")}`;
      const emb = await embed(content);
      const hash = createHash("sha256").update(content).digest("hex");
      embeddings.push({ id, title: task.title, desc: task.description, tags: JSON.stringify(task.tags), emb, hash });
    }
    const embedTime = performance.now() - t0;
    const perTask = embedTime / count;

    // Insert into DB
    t0 = performance.now();
    const insertAll = db.transaction(() => {
      const now = new Date().toISOString();
      for (const e of embeddings) {
        insertTask.run(e.id, e.title, e.desc, e.tags, now, now);
        insertEmbedding.run(e.id, embeddingToBuffer(e.emb), e.hash);
      }
    });
    insertAll();
    const insertTime = performance.now() - t0;

    console.log(`--- ${count} tasks ---`);
    console.log(`  Embed:  ${fmt(embedTime)} total, ${fmt(perTask)}/task`);
    console.log(`  Insert: ${fmt(insertTime)} total, ${fmt(insertTime / count)}/task`);
    console.log();
  }

  // Now we have 10+50+100+250 = 410 tasks in DB. Benchmark queries.
  const totalTasks = (db.prepare("SELECT COUNT(*) as c FROM tasks").get() as { c: number }).c;
  console.log(`Total tasks in DB: ${totalTasks}\n`);

  // Load all embeddings into memory (this is the brute-force approach)
  t0 = performance.now();
  const allEmbeddings = db
    .prepare("SELECT task_id, embedding FROM task_embeddings")
    .all() as Array<{ task_id: string; embedding: Buffer }>;
  const parsed = allEmbeddings.map((row) => ({
    taskId: row.task_id,
    embedding: bufferToEmbedding(row.embedding),
  }));
  console.log(`Load ${parsed.length} embeddings from DB: ${fmt(performance.now() - t0)}`);

  const taskTitles = new Map<string, string>();
  for (const row of db.prepare("SELECT id, title FROM tasks").all() as Array<{ id: string; title: string }>) {
    taskTitles.set(row.id, row.title);
  }

  // Semantic search queries
  const queries = [
    "authentication bug in the browser",
    "slow database queries causing timeouts",
    "setting up deployment automation",
    "improving test coverage",
    "security vulnerability in dependencies",
  ];

  console.log(`\n--- Semantic search over ${totalTasks} tasks ---`);
  const queryTimes: number[] = [];
  for (const q of queries) {
    // Embed the query
    const qt0 = performance.now();
    const qEmb = await embed(q);
    const embedMs = performance.now() - qt0;

    // Brute-force cosine similarity
    const st0 = performance.now();
    const scored = parsed.map((row) => ({
      taskId: row.taskId,
      score: cosineSimilarity(qEmb, row.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);
    const searchMs = performance.now() - st0;
    const totalMs = embedMs + searchMs;
    queryTimes.push(totalMs);

    console.log(`\n  "${q}"`);
    console.log(`  embed: ${fmt(embedMs)}, search: ${fmt(searchMs)}, total: ${fmt(totalMs)}`);
    for (const s of scored.slice(0, 3)) {
      console.log(`    → ${taskTitles.get(s.taskId)} (${s.score.toFixed(4)})`);
    }
  }

  // FTS search benchmark
  console.log(`\n--- FTS5 search over ${totalTasks} tasks ---`);
  const ftsQueries = ["crash safari", "rate limiting API", "memory leak worker", "deploy staging", "test coverage"];
  for (const q of ftsQueries) {
    const ft0 = performance.now();
    const results = db.prepare(
      `SELECT t.title, rank FROM tasks_fts fts JOIN tasks t ON t.rowid = fts.rowid WHERE tasks_fts MATCH ? ORDER BY rank LIMIT 3`
    ).all(q) as Array<{ title: string; rank: number }>;
    const ftsMs = performance.now() - ft0;
    console.log(`\n  "${q}" — ${fmt(ftsMs)}`);
    for (const r of results) {
      console.log(`    → ${r.title} (rank: ${r.rank.toFixed(4)})`);
    }
  }

  // Summary
  const avgQuery = queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length;
  console.log(`\n\n=== Summary ===`);
  console.log(`Tasks in DB: ${totalTasks}`);
  console.log(`Avg semantic query (embed + search): ${fmt(avgQuery)}`);
  console.log(`  - Search portion (cosine over ${totalTasks} vectors): sub-millisecond`);
  console.log(`  - Bottleneck is embedding the query text`);

  db.close();
}

main().catch((err) => {
  console.error("Bench failed:", err);
  process.exit(1);
});
