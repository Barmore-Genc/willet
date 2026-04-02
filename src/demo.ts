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

// --- Sample tasks to insert ---
const SAMPLE_TASKS = [
  {
    title: "Fix login page crash on Safari",
    description:
      "Users on Safari 17 report a white screen when clicking 'Sign In'. Console shows a TypeError in the auth handler.",
    tags: ["bug", "auth", "safari"],
  },
  {
    title: "Add dark mode support",
    description:
      "Implement system-preference-aware dark mode across all pages. Should respect prefers-color-scheme media query.",
    tags: ["feature", "ui", "accessibility"],
  },
  {
    title: "Migrate user table to UUID primary keys",
    description:
      "Replace auto-increment integer IDs with UUIDs to support cross-region replication. Needs a migration script.",
    tags: ["database", "migration", "infrastructure"],
  },
  {
    title: "Write API rate limiting middleware",
    description:
      "Implement token bucket rate limiting for the public API. Should support per-user and per-IP limits with Redis backing.",
    tags: ["feature", "api", "security"],
  },
  {
    title: "Investigate memory leak in worker process",
    description:
      "The background job worker's RSS grows ~50MB/hour. Likely related to the image processing pipeline not releasing buffers.",
    tags: ["bug", "performance", "workers"],
  },
  {
    title: "Set up CI pipeline for mobile app",
    description:
      "Configure GitHub Actions to build, test, and deploy the React Native app. Include Detox E2E tests on iOS simulator.",
    tags: ["devops", "ci", "mobile"],
  },
  {
    title: "Refactor notification service to use event bus",
    description:
      "Currently notifications are sent inline during request handling. Move to an async event bus pattern to decouple and improve latency.",
    tags: ["refactor", "architecture", "notifications"],
  },
  {
    title: "Update OAuth scopes for Google integration",
    description:
      "Google is deprecating some OAuth scopes we use for Calendar access. Need to migrate to the new granular scopes before June.",
    tags: ["auth", "google", "deadline"],
  },
  {
    title: "Add pagination to task list endpoint",
    description:
      "The /api/tasks endpoint returns all tasks at once. Add cursor-based pagination with configurable page size.",
    tags: ["feature", "api", "performance"],
  },
  {
    title: "Fix race condition in checkout flow",
    description:
      "Under concurrent requests, two users can claim the last inventory item. Need to add optimistic locking or a reservation system.",
    tags: ["bug", "critical", "payments"],
  },
];

async function main() {
  console.log("=== Task Manager Demo ===\n");

  // 1. Initialize embeddings (downloads model on first run)
  console.log("Initializing embeddings model...");
  await initEmbeddings();
  console.log("Embeddings ready.\n");

  // 2. Create an in-memory SQLite database
  const db = new Database(":memory:");
  applySchema(db);
  console.log("Database schema applied.\n");

  // 3. Insert sample tasks with embeddings
  const insertTask = db.prepare(`
    INSERT INTO tasks (id, title, description, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertEmbedding = db.prepare(`
    INSERT INTO task_embeddings (task_id, embedding, content_hash)
    VALUES (?, ?, ?)
  `);

  console.log("Inserting tasks and computing embeddings...");
  const insertAll = db.transaction(async () => {
    // We can't use async inside a transaction directly, so collect first
  });

  // Compute embeddings first (async), then insert in a transaction
  const taskData: Array<{
    id: string;
    title: string;
    description: string;
    tags: string;
    embedding: Float32Array;
    contentHash: string;
  }> = [];

  for (const task of SAMPLE_TASKS) {
    const id = ulid();
    const content = `${task.title}\n${task.description}\n${task.tags.join(", ")}`;
    const embedding = await embed(content);
    const contentHash = createHash("sha256").update(content).digest("hex");
    taskData.push({
      id,
      title: task.title,
      description: task.description,
      tags: JSON.stringify(task.tags),
      embedding,
      contentHash,
    });
    process.stdout.write(".");
  }
  console.log(" done!\n");

  // Insert in a single transaction
  const insertAllSync = db.transaction(() => {
    const now = new Date().toISOString();
    for (const t of taskData) {
      insertTask.run(t.id, t.title, t.description, t.tags, now, now);
      insertEmbedding.run(t.id, embeddingToBuffer(t.embedding), t.contentHash);
    }
  });
  insertAllSync();

  const count = db.prepare("SELECT COUNT(*) as c FROM tasks").get() as { c: number };
  console.log(`Inserted ${count.c} tasks with embeddings.\n`);

  // 4. Test FTS5 text search
  console.log("--- FTS5 Text Search ---");
  const ftsQueries = ["login crash", "OAuth Google", "rate limiting"];
  for (const q of ftsQueries) {
    const results = db
      .prepare(
        `SELECT t.title, rank
         FROM tasks_fts fts
         JOIN tasks t ON t.rowid = fts.rowid
         WHERE tasks_fts MATCH ?
         ORDER BY rank
         LIMIT 3`
      )
      .all(q) as Array<{ title: string; rank: number }>;
    console.log(`\n  Query: "${q}"`);
    if (results.length === 0) {
      console.log("    (no results)");
    }
    for (const r of results) {
      console.log(`    → ${r.title} (rank: ${r.rank.toFixed(4)})`);
    }
  }

  // 5. Test semantic (vector) search
  console.log("\n\n--- Semantic Vector Search ---");
  const semanticQueries = [
    "authentication problems in the browser",
    "making the app look better at night",
    "database schema changes for scaling",
    "protecting the API from abuse",
    "app is using too much memory",
    "continuous integration and deployment",
  ];

  // Load all embeddings
  const allEmbeddings = db
    .prepare("SELECT task_id, embedding FROM task_embeddings")
    .all() as Array<{ task_id: string; embedding: Buffer }>;
  const taskTitles = new Map<string, string>();
  for (const row of db.prepare("SELECT id, title FROM tasks").all() as Array<{
    id: string;
    title: string;
  }>) {
    taskTitles.set(row.id, row.title);
  }

  for (const q of semanticQueries) {
    const queryEmbedding = await embed(q);

    const scored = allEmbeddings.map((row) => ({
      taskId: row.task_id,
      score: cosineSimilarity(queryEmbedding, bufferToEmbedding(row.embedding)),
    }));
    scored.sort((a, b) => b.score - a.score);

    console.log(`\n  Query: "${q}"`);
    for (const s of scored.slice(0, 3)) {
      console.log(
        `    → ${taskTitles.get(s.taskId)} (similarity: ${s.score.toFixed(4)})`
      );
    }
  }

  // 6. Test hybrid search (RRF)
  console.log("\n\n--- Hybrid Search (RRF) ---");
  const hybridQuery = "fix authentication bug";
  const k = 60; // RRF constant

  // FTS results
  const ftsResults = db
    .prepare(
      `SELECT t.id, t.title
       FROM tasks_fts fts
       JOIN tasks t ON t.rowid = fts.rowid
       WHERE tasks_fts MATCH ?
       ORDER BY rank
       LIMIT 10`
    )
    .all(hybridQuery.split(/\s+/).join(" OR ")) as Array<{ id: string; title: string }>;

  // Vector results
  const queryEmb = await embed(hybridQuery);
  const vectorScored = allEmbeddings
    .map((row) => ({
      id: row.task_id,
      score: cosineSimilarity(queryEmb, bufferToEmbedding(row.embedding)),
    }))
    .sort((a, b) => b.score - a.score);

  // RRF fusion
  const rrfScores = new Map<string, number>();
  ftsResults.forEach((r, i) => {
    rrfScores.set(r.id, (rrfScores.get(r.id) ?? 0) + 1 / (k + i + 1));
  });
  vectorScored.forEach((r, i) => {
    rrfScores.set(r.id, (rrfScores.get(r.id) ?? 0) + 1 / (k + i + 1));
  });

  const hybridResults = [...rrfScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  console.log(`\n  Query: "${hybridQuery}"`);
  for (const [id, score] of hybridResults) {
    console.log(`    → ${taskTitles.get(id)} (RRF score: ${score.toFixed(6)})`);
  }

  console.log("\n\n=== Demo complete! ===");
  db.close();
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
