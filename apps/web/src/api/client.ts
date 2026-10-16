import type {
  ChatSnapshot,
  ChatSummary,
  CreateChatInput,
  ModelView,
  ProviderView,
  StartRunInput,
  Todo,
  UpdateTodoInput,
} from "@crewbus/contracts";
import { request } from "./http.js";
const segment = encodeURIComponent;
const chat = (id: string) => `/chats/${segment(id)}`;
const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
export const api = {
  providers: () => request<ProviderView[]>("/providers"),
  models: (id: string) =>
    request<ModelView[]>(`/providers/${segment(id)}/models`),
  saveKey: (id: string, key: string) =>
    request<void>(`/providers/${segment(id)}/credential`, json("PUT", { key })),
  deleteKey: (id: string) =>
    request<void>(`/providers/${segment(id)}/credential`, json("DELETE")),
  chats: () => request<ChatSummary[]>("/chats"),
  createChat: (selection: CreateChatInput) =>
    request<ChatSummary>("/chats", json("POST", selection)),
  setModel: (id: string, selection: CreateChatInput) =>
    request<ChatSummary>(chat(id), json("PATCH", selection)),
  snapshot: (id: string, signal?: AbortSignal) =>
    request<ChatSnapshot>(chat(id), signal ? { signal } : {}),
  startRun: (id: string, input: StartRunInput) =>
    request<{ runId: string }>(`${chat(id)}/runs`, json("POST", input)),
  abortRun: (id: string) =>
    request<{ runId: string }>(`/runs/${segment(id)}/abort`, json("POST")),
  createTodo: (id: string, input: { title: string }) =>
    request<Todo>(`${chat(id)}/todos`, json("POST", input)),
  updateTodo: (id: string, todoId: string, input: UpdateTodoInput) =>
    request<Todo>(`${chat(id)}/todos/${segment(todoId)}`, json("PATCH", input)),
  deleteTodo: (id: string, todoId: string) =>
    request<{ id: string }>(
      `${chat(id)}/todos/${segment(todoId)}`,
      json("DELETE"),
    ),
};
