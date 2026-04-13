import { z } from "zod";

// --- Enums ---

export const StatusSchema = z.enum(["open", "in_progress", "done", "cancelled"]);
export type Status = z.infer<typeof StatusSchema>;

export const TaskTypeSchema = z.enum(["task", "bug", "feature", "epic"]);
export type TaskType = z.infer<typeof TaskTypeSchema>;

export const PrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const LinkTypeSchema = z.enum(["blocks", "relates_to", "duplicates"]);
export type LinkType = z.infer<typeof LinkTypeSchema>;

export const SearchModeSchema = z.enum(["text", "semantic", "hybrid"]);
export type SearchMode = z.infer<typeof SearchModeSchema>;

export const SortFieldSchema = z.enum([
  "created_at",
  "updated_at",
  "priority",
  "status",
  "title",
  "type",
]);
export type SortField = z.infer<typeof SortFieldSchema>;

export const SortDirectionSchema = z.enum(["asc", "desc"]);
export type SortDirection = z.infer<typeof SortDirectionSchema>;

export const GroupBySchema = z.enum(["status", "priority", "type"]);
export type GroupBy = z.infer<typeof GroupBySchema>;

// --- Helper: accept single value or array ---

function stringOrArray<T extends z.ZodType<string>>(schema: T) {
  return z.union([schema, z.array(schema)]);
}

// --- Entity types ---

export interface Project {
  id: string;
  name: string;
  directory: string;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: Status;
  type: TaskType;
  priority: Priority;
  estimate: string | null;
  actual: string | null;
  tags: string[];
  parent_task_id: string | null;
  assignee: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  metadata: Record<string, unknown>;
}

export interface TaskHistory {
  id: string;
  task_id: string;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
  changed_by: string;
}

export interface TaskLink {
  id: string;
  source_task_id: string;
  target_task_id: string;
  link_type: LinkType;
  created_at: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  content: string;
  created_at: string;
  created_by: string;
}

// --- Tool input schemas ---

export const InitProjectInputSchema = z.object({
  name: z.string().min(1),
});

export const ListProjectsInputSchema = z.object({
  name: z.string().optional(),
});

export const TaskLinkInputSchema = z.object({
  target_task_id: z.string(),
  link_type: LinkTypeSchema,
});

export const CreateTaskInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: StatusSchema.optional(),
  type: TaskTypeSchema.optional(),
  priority: PrioritySchema.optional(),
  estimate: z.string().optional(),
  tags: z.array(z.string()).optional(),
  parent_task_id: z.string().optional(),
  assignee: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  links: z.array(TaskLinkInputSchema).optional(),
  initial_comment: z.string().optional(),
});

export const UpdateTaskInputSchema = z.object({
  task_id: z.string(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  type: TaskTypeSchema.optional(),
  priority: PrioritySchema.optional(),
  estimate: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  parent_task_id: z.string().nullable().optional(),
  assignee: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const GetTaskInputSchema = z.object({
  task_id: z.string(),
  include_history: z.boolean().optional(),
  include_subtasks: z.boolean().optional(),
});

export const DeleteTaskInputSchema = z.object({
  task_id: z.string(),
});

export const StartTaskInputSchema = z.object({
  task_id: z.string(),
});

export const CompleteTaskInputSchema = z.object({
  task_id: z.string(),
  actual: z.string().optional(),
});

export const CancelTaskInputSchema = z.object({
  task_id: z.string(),
});

export const ReopenTaskInputSchema = z.object({
  task_id: z.string(),
});

export const AddCommentInputSchema = z.object({
  task_id: z.string(),
  content: z.string().min(1),
});

export const LinkTasksInputSchema = z.object({
  source_task_id: z.string(),
  target_task_id: z.string(),
  link_type: LinkTypeSchema,
});

export const UnlinkTasksInputSchema = z.object({
  source_task_id: z.string(),
  target_task_id: z.string(),
  link_type: LinkTypeSchema,
});

export const ListTasksInputSchema = z.object({
  status: stringOrArray(StatusSchema).optional(),
  type: stringOrArray(TaskTypeSchema).optional(),
  priority: stringOrArray(PrioritySchema).optional(),
  tags: z.array(z.string()).optional(),
  parent_task_id: z.string().nullable().optional(),
  assignee: z.string().nullable().optional(),
  created_after: z.string().optional(),
  created_before: z.string().optional(),
  completed_after: z.string().optional(),
  completed_before: z.string().optional(),
  sort: SortFieldSchema.optional(),
  sort_direction: SortDirectionSchema.optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});

export const SearchTasksInputSchema = z.object({
  query: z.string().min(1),
  mode: SearchModeSchema.optional(),
  status: stringOrArray(StatusSchema).optional(),
  type: stringOrArray(TaskTypeSchema).optional(),
  priority: stringOrArray(PrioritySchema).optional(),
  limit: z.number().int().positive().optional(),
});

export const GetTaskGraphInputSchema = z.object({
  task_id: z.string(),
  depth: z.number().int().min(1).max(5).optional(),
});

export const RenderTaskBoardInputSchema = z.object({
  group_by: GroupBySchema.optional(),
  status: stringOrArray(StatusSchema).optional(),
  type: stringOrArray(TaskTypeSchema).optional(),
  priority: stringOrArray(PrioritySchema).optional(),
  tags: z.array(z.string()).optional(),
});

export const GetProjectStatsInputSchema = z.object({});

export const ListTagsInputSchema = z.object({});

export const RenderDependencyGraphInputSchema = z.object({
  task_id: z.string(),
  depth: z.number().int().min(1).max(5).optional(),
});

// --- Mode-aware tool options ---

export interface ToolOptions {
  mode: "local" | "selfhosted";
  validAssignees?: string[];
}

/** Strip assignee from a task object (local mode only) */
export function formatTask(task: Task, options: ToolOptions): Omit<Task, "assignee"> | Task {
  if (options.mode === "local") {
    const { assignee, ...rest } = task;
    return rest;
  }
  return task;
}

/** Strip assignee from an array of tasks (local mode only) */
export function formatTasks(tasks: Task[], options: ToolOptions): Array<Omit<Task, "assignee"> | Task> {
  if (options.mode === "local") {
    return tasks.map(({ assignee, ...rest }) => rest);
  }
  return tasks;
}

/** Validate assignee against the config user list (self-hosted only). Throws on invalid. */
export function validateAssignee(assignee: string | null | undefined, options: ToolOptions): void {
  if (options.mode === "selfhosted" && options.validAssignees && assignee != null) {
    if (!options.validAssignees.includes(assignee)) {
      throw new Error(
        `Invalid assignee "${assignee}". Valid users: ${options.validAssignees.join(", ")}`
      );
    }
  }
}

// --- Project-scoped schema helper ---

/** Adds optional project_id to any tool input schema */
export function withProjectId<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.extend({
    project_id: z.string().optional(),
  });
}