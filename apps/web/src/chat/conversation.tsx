import type { ChatSnapshot } from "@crewbus/contracts";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputProvider,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputFooter,
} from "@/components/ai-elements/prompt-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToolCard } from "./tool-card.js";
const reasons = {
  turn_limit: "Достигнут лимит: 20 обращений к модели.",
  timeout: "Превышено время ожидания: 5 минут.",
  user_abort: "Запуск остановлен.",
  context_overflow: "Контекст диалога переполнен. Создайте новый диалог.",
  provider_error: "Провайдер не выполнил запрос. Проверьте API-ключ и модель.",
  storage_error: "Не удалось сохранить результат.",
  process_restart: "Запуск прерван перезапуском сервера.",
};
export function ChatConversation({
  snapshot,
  send,
  stop,
  disabled,
  retryPending,
  retrySend,
}: {
  snapshot: ChatSnapshot;
  send: (text: string) => Promise<void>;
  stop: () => Promise<void>;
  disabled: boolean;
  retryPending: boolean;
  retrySend: () => Promise<void>;
}) {
  const running = snapshot.run?.status === "running";
  return (
    <>
      <Conversation
        data-testid="conversation"
        aria-label="Переписка"
        className="min-h-0"
      >
        <ConversationContent className="mx-auto w-full max-w-3xl gap-7 p-5 md:p-8">
          {snapshot.messages.length ? (
            snapshot.messages.map((message) => (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  <span className="mb-2 block text-xs font-medium text-muted-foreground">
                    {message.role === "user" ? "Вы" : "Crewbus"}
                  </span>
                  {message.role === "assistant" ? (
                    <MessageResponse>{message.text}</MessageResponse>
                  ) : (
                    <p className="whitespace-pre-wrap break-words">
                      {message.text}
                    </p>
                  )}
                  {message.role === "assistant" && message.state === "interrupted" && (
                    <Badge variant="outline" role="status">Ответ прерван</Badge>
                  )}
                </MessageContent>
                {message.tools.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} />
                ))}
              </Message>
            ))
          ) : (
            <ConversationEmptyState
              title="С чего начнём?"
              description="Обсудите планы — Crewbus поможет превратить их в задачи."
            />
          )}
        </ConversationContent>
        <ConversationScrollButton aria-label="К последнему сообщению" />
      </Conversation>
      <div className="composer mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pb-4 md:px-8 md:pb-6">
        {snapshot.run?.reason && (
          <p className="text-sm text-muted-foreground" role="status">
            {reasons[snapshot.run.reason]}
          </p>
        )}
        {running && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground" role="status">
              Crewbus работает…
            </p>
            <Button variant="outline" onClick={() => void stop()}>
              Остановить
            </Button>
          </div>
        )}
        <PromptInputProvider>
          <PromptInput
            onSubmit={async ({ text }) =>
              retryPending ? retrySend() : send(text)
            }
            maxFiles={0}
          >
            <PromptInputTextarea
              aria-label="Сообщение"
              placeholder="Напишите сообщение…"
              maxLength={16000}
              disabled={running || disabled || retryPending}
            />
            <PromptInputFooter>
              <span className="text-xs text-muted-foreground">
                Enter — отправить · Shift + Enter — перенос
              </span>
              <PromptInputSubmit
                aria-label={retryPending ? "Повторить отправку" : "Отправить"}
                disabled={running || disabled}
              />
            </PromptInputFooter>
          </PromptInput>
        </PromptInputProvider>
      </div>
    </>
  );
}
