import { useState } from "react";
import type { Todo } from "@crewbus/contracts";
import { api } from "../api/client.js";
import { HttpError } from "../api/http.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { PencilIcon, Trash2Icon, CheckIcon, PlusIcon } from "lucide-react";
export function TodoPanel({
  chatId,
  todos,
  running,
  refresh,
}: {
  chatId: string;
  todos: Todo[];
  running: boolean;
  refresh: () => Promise<void>;
}) {
  const [title, setTitle] = useState(""),
    [editing, setEditing] = useState<string | null>(null),
    [editTitle, setEditTitle] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const mutate = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(
        e instanceof HttpError ? e.message : "Не удалось сохранить задачу.",
      );
      if (e instanceof HttpError && e.statusCode === 409) await refresh();
    } finally {
      setBusy(false);
    }
  };
  const disabled = running || busy;
  return (
    <section
      data-testid="todo-panel"
      className="flex h-full min-h-0 flex-col gap-5 p-5"
      aria-label="Задачи"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Задачи</h2>
        <Badge variant="secondary">
          {todos.filter((t) => !t.completed).length}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        План этого диалога. Задачи сохраняются автоматически.
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!todos.length ? (
          <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
            Пока нет задач. Попросите Crewbus составить план или добавьте задачу
            вручную.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {todos.map((todo) => (
              <li
                key={todo.id}
                className="flex items-start gap-2 rounded-lg border bg-background p-3"
              >
                <Checkbox
                  aria-label={`Завершить: ${todo.title}`}
                  checked={todo.completed}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    void mutate(() =>
                      api.updateTodo(chatId, todo.id, {
                        completed: checked === true,
                      }),
                    )
                  }
                />
                {editing === todo.id ? (
                  <form
                    className="flex min-w-0 flex-1 gap-1"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void mutate(async () => {
                        await api.updateTodo(chatId, todo.id, {
                          title: editTitle,
                        });
                        setEditing(null);
                      });
                    }}
                  >
                    <Input
                      autoFocus
                      aria-label="Название задачи"
                      maxLength={500}
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      disabled={disabled}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Сохранить задачу"
                      disabled={disabled || !editTitle.trim()}
                    >
                      <CheckIcon />
                    </Button>
                  </form>
                ) : (
                  <>
                    <span
                      className={`min-w-0 flex-1 break-words text-sm ${todo.completed ? "text-muted-foreground line-through" : ""}`}
                    >
                      {todo.title}
                    </span>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Изменить: ${todo.title}`}
                      disabled={disabled}
                      onClick={() => {
                        setEditing(todo.id);
                        setEditTitle(todo.title);
                      }}
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Удалить: ${todo.title}`}
                      disabled={disabled}
                      onClick={() =>
                        void mutate(() => api.deleteTodo(chatId, todo.id))
                      }
                    >
                      <Trash2Icon />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void mutate(async () => {
            await api.createTodo(chatId, { title });
            setTitle("");
          });
        }}
      >
        <Input
          aria-label="Новая задача"
          placeholder="Добавить задачу…"
          maxLength={500}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={disabled}
        />
        <Button
          size="icon"
          aria-label="Добавить задачу"
          disabled={disabled || !title.trim()}
        >
          <PlusIcon />
        </Button>
      </form>
      {running && (
        <p className="text-xs text-muted-foreground">
          Редактирование доступно после завершения запуска.
        </p>
      )}
    </section>
  );
}
