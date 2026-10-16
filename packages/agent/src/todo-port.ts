import type { JsonValue, TodoToolName } from '@crewbus/contracts';

export interface ToolContext {
  chatId: string;
  runId: string;
  toolCallId: string;
}

/** Synchronous, durable todo operation boundary; the server owns business validation. */
export interface TodoPort {
  apply(context: ToolContext, name: TodoToolName, input: unknown, signal?: AbortSignal): JsonValue;
}
