import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatSummary, ModelView, ProviderView } from "@crewbus/contracts";
import { api } from "./api/client.js";
import { useChat } from "./chat/use-chat.js";
import { ChatConversation } from "./chat/conversation.js";
import { ModelSelector, ProviderDialog } from "./settings/provider-dialog.js";
import { TodoPanel } from "./todos/todo-panel.js";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetHeader,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  PlusIcon,
  MessagesSquareIcon,
  PanelLeftIcon,
  ListTodoIcon,
  SettingsIcon,
  ArrowRightIcon,
} from "lucide-react";
const selectedId = () =>
  new URL(window.location.href).searchParams.get("chat") ?? "";
export function App() {
  const sidebarTrigger = useRef<HTMLButtonElement>(null),
    tasksTrigger = useRef<HTMLButtonElement>(null),
    dialogTrigger = useRef<HTMLElement | null>(null);
  const [chatId, setChatId] = useState(selectedId),
    [chats, setChats] = useState<ChatSummary[]>([]),
    [providers, setProviders] = useState<ProviderView[]>([]),
    [models, setModels] = useState<ModelView[]>([]);
  const [dialog, setDialog] = useState<"new" | "settings" | null>(null),
    [sidebar, setSidebar] = useState(false),
    [tasks, setTasks] = useState(false),
    [error, setError] = useState("");
  const chat = useChat(chatId),
    snapshot = chat.snapshot,
    running = snapshot?.run?.status === "running";
  const loadCatalog = useCallback(() => {
    void api
      .providers()
      .then(setProviders)
      .catch(() => setError("Не удалось загрузить провайдеров."));
  }, []);
  const loadChats = useCallback(() => {
    void api
      .chats()
      .then(setChats)
      .catch(() => setError("Не удалось загрузить диалоги."));
  }, []);
  useEffect(() => {
    loadCatalog();
    loadChats();
    const pop = () => setChatId(selectedId());
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [loadCatalog, loadChats]);
  useEffect(() => {
    if (!snapshot) return;
    let live = true;
    setModels([]);
    void api
      .models(snapshot.chat.providerId)
      .then((value) => {
        if (live) setModels(value);
      })
      .catch(() => {
        if (live) setError("Не удалось загрузить модели.");
      });
    loadChats();
    return () => {
      live = false;
    };
  }, [snapshot?.chat.providerId, chatId, loadChats]);
  const select = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("chat", id);
    window.history.pushState(null, "", url);
    setChatId(id);
    setSidebar(false);
  };
  const openDialog = (mode: "new" | "settings") => {
    dialogTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setDialog(mode);
  };
  const navigation = (
    <nav
      className="flex h-full min-h-0 flex-col gap-6 p-5"
      aria-label="Диалоги"
    >
      <div className="flex items-center gap-2 text-lg font-semibold">
        <span className="brand-mark">
          <MessagesSquareIcon />
        </span>
        Crewbus
      </div>
      <Button
        onClick={() => {
          setSidebar(false);
          openDialog("new");
        }}
      >
        <PlusIcon data-icon="inline-start" />
        Новый диалог
      </Button>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Ваши диалоги
        </p>
        {chats.length ? (
          chats.map((item) => (
            <Button
              key={item.id}
              data-chat-id={item.id}
              variant={item.id === chatId ? "secondary" : "ghost"}
              className="h-auto justify-start whitespace-normal py-3 text-left"
              aria-current={item.id === chatId ? "page" : undefined}
              onClick={() => select(item.id)}
            >
              <span className="truncate">
                {item.title === "New chat" ? "Новый диалог" : item.title}
              </span>
            </Button>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            Здесь появятся ваши разговоры.
          </p>
        )}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Личное пространство для мыслей и действий.
      </p>
    </nav>
  );
  const todos = snapshot ? (
    <TodoPanel
      key={chatId}
      chatId={chatId}
      todos={snapshot.todos}
      running={running}
      refresh={chat.refresh}
    />
  ) : null;
  const configured =
    providers.find((provider) => provider.id === snapshot?.chat.providerId)
      ?.configured ?? false;
  return (
    <main className="app-shell">
      <aside className="desktop-navigation border-r bg-sidebar">
        {navigation}
      </aside>
      <section className="chat-column">
        <header className="flex min-h-20 shrink-0 items-center justify-between gap-3 border-b bg-card px-4 md:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              className="mobile-toggle"
              variant="ghost"
              size="icon"
              ref={sidebarTrigger}
              aria-label="Открыть диалоги"
              onClick={() => setSidebar(true)}
            >
              <PanelLeftIcon />
            </Button>
            <div className="min-w-0">
              <h1 tabIndex={-1} className="truncate font-semibold">
                {snapshot
                  ? snapshot.chat.title === "New chat"
                    ? "Новый диалог"
                    : snapshot.chat.title
                  : "Ваш следующий шаг"}
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {snapshot
                  ? "Диалог и задачи — в одном месте"
                  : "Crewbus · помощник для ваших планов"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {snapshot && (
              <>
                <div className="desktop-model">
                  <ModelSelector
                    models={models}
                    value={snapshot.chat.modelId}
                    disabled={running || chat.loading}
                    onChange={(value) =>
                      void api
                        .setModel(chatId, {
                          providerId: snapshot.chat.providerId,
                          modelId: value,
                        })
                        .then(() => chat.refresh())
                        .catch(() => {
                          setError("Не удалось сменить модель.");
                          void chat.refresh();
                        })
                    }
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Настройки"
                  disabled={running}
                  onClick={() => openDialog("settings")}
                >
                  <SettingsIcon />
                </Button>
                <Button
                  className="mobile-toggle"
                  variant="outline"
                  size="icon"
                  ref={tasksTrigger}
                  aria-label="Открыть задачи"
                  onClick={() => setTasks(true)}
                >
                  <ListTodoIcon />
                </Button>
              </>
            )}
          </div>
        </header>
        {(error || chat.error) && (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 border-b bg-card px-5 py-3 text-sm text-destructive"
          >
            <span>{error || chat.error}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setError("");
                void chat.refresh();
                loadCatalog();
                loadChats();
              }}
            >
              Обновить
            </Button>
          </div>
        )}
        {snapshot ? (
          <>
            {!configured && (
              <div className="flex items-center justify-between gap-3 border-b px-5 py-3 text-sm">
                <span>Настройте API-ключ, чтобы отправить сообщение.</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openDialog("settings")}
                >
                  Настроить
                </Button>
              </div>
            )}
            <ChatConversation
              key={chatId}
              snapshot={snapshot}
              send={chat.send}
              stop={chat.stop}
              disabled={chat.loading || !configured}
              retryPending={chat.retryPending}
              retrySend={chat.retrySend}
            />
          </>
        ) : chat.loading ? (
          <div
            className="flex flex-col gap-5 p-8"
            aria-label="Загрузка диалога"
          >
            <Skeleton className="h-20 w-3/4" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
            <Badge variant="secondary">Мысли → действия</Badge>
            <h2 className="max-w-lg text-3xl font-semibold tracking-tight">
              Дайте планам место
              <br />
              для разговора.
            </h2>
            <p className="max-w-sm text-sm leading-7 text-muted-foreground">
              Обсуждайте идеи, выбирайте следующий шаг и сохраняйте задачи
              вместе с Crewbus.
            </p>
            <Button onClick={() => openDialog("new")}>
              Начать разговор
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </div>
        )}
      </section>
      <aside className="desktop-todos border-l bg-card">
        {todos ?? (
          <div className="p-6 text-sm text-muted-foreground">
            <h2 className="mb-3 font-semibold text-foreground">Задачи</h2>
            Выберите диалог, чтобы увидеть его план.
          </div>
        )}
      </aside>
      <Sheet open={sidebar} onOpenChange={setSidebar}>
        <SheetContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            sidebarTrigger.current?.focus();
          }}
          side="left"
          className="gap-0 p-0"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Диалоги</SheetTitle>
            <SheetDescription>Выберите или создайте диалог</SheetDescription>
          </SheetHeader>
          {navigation}
        </SheetContent>
      </Sheet>
      <Sheet open={tasks} onOpenChange={setTasks}>
        <SheetContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            tasksTrigger.current?.focus();
          }}
          className="tasks-sheet gap-0 p-0"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Задачи диалога</SheetTitle>
            <SheetDescription>
              Сохранённые задачи и ручное редактирование
            </SheetDescription>
          </SheetHeader>
          {todos}
        </SheetContent>
      </Sheet>
      <ProviderDialog
        open={dialog !== null}
        onOpenChange={(value) => {
          if (!value) setDialog(null);
        }}
        {...(dialog === "settings" && snapshot
          ? {
              selection: {
                providerId: snapshot.chat.providerId,
                modelId: snapshot.chat.modelId,
              },
            }
          : {})}
        onCreated={(created) => {
          setChats((items) => [created, ...items]);
          select(created.id);
        }}
        onConfigured={loadCatalog}
        onReturnFocus={() => {
          if (dialogTrigger.current?.isConnected) dialogTrigger.current.focus();
          else if (sidebarTrigger.current?.getClientRects().length)
            sidebarTrigger.current.focus();
          else document.querySelector("h1")?.focus();
        }}
        onModelChange={async (selection) => {
          await api.setModel(chatId, selection);
          await chat.refresh();
        }}
      />
    </main>
  );
}
