import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CreateArticleInputSchema,
  GetArticleInputSchema,
  ListArticlesInputSchema,
  UpdateArticleInputSchema,
  withProjectId,
  type Article,
} from "../models/types.js";
import {
  createArticle,
  getArticleById,
  getProject,
  getProjectDb,
  listArticles,
  updateArticle,
} from "../db/queries.js";

function resolveDb(projectId?: string) {
  const project = getProject(process.cwd(), projectId);
  return getProjectDb(project.id);
}

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function summarize({ content, ...rest }: Article): Omit<Article, "content"> {
  return rest;
}

export function registerArticleTools(server: McpServer): void {
  server.tool(
    "create_article",
    "Create a knowledge base article: durable project knowledge such as rationale, decision records, or research findings that outlive the ticket that prompted them.",
    withProjectId(CreateArticleInputSchema).shape,
    async ({ project_id, ...input }) => {
      const db = resolveDb(project_id);
      return json(await createArticle(db, input));
    }
  );

  server.tool(
    "get_article",
    "Get a knowledge base article by ID, including its full content",
    withProjectId(GetArticleInputSchema).shape,
    async ({ project_id, article_id }) => {
      const db = resolveDb(project_id);
      const article = getArticleById(db, article_id);
      if (!article) throw new Error(`Article not found: ${article_id}`);
      return json(article);
    }
  );

  server.tool(
    "update_article",
    "Edit an article in place, or archive and restore it with `status`. Pass the full new content; updates replace, they do not append.",
    withProjectId(UpdateArticleInputSchema).shape,
    async ({ project_id, ...input }) => {
      const db = resolveDb(project_id);
      return json(await updateArticle(db, input));
    }
  );

  server.tool(
    "list_articles",
    "List knowledge base articles, newest edits first. Archived articles are excluded unless status says otherwise, and bodies are omitted unless include_content is set. Read one with get_article.",
    withProjectId(ListArticlesInputSchema).shape,
    async ({ project_id, include_content, ...opts }) => {
      const db = resolveDb(project_id);
      const { articles, total } = listArticles(db, opts);
      return json({
        articles: include_content ? articles : articles.map(summarize),
        total,
      });
    }
  );
}
