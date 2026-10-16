import { useCallback, useEffect, useRef, useState } from "react";
import {
  reduceChat,
  type ChatSnapshot,
  type StartRunInput,
} from "@crewbus/contracts";
import { api } from "../api/client.js";
import { HttpError } from "../api/http.js";
import { connectEvents } from "../api/events.js";
export function useChat(chatId: string) {
  const [snapshot, setSnapshot] = useState<ChatSnapshot | null>(null);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null);
  // An old todo/stop callback may finish after navigation and call its old refresh.
  const activeChat = useRef(chatId);
  activeChat.current = chatId;
  // Generation belongs to the selected chat; revision belongs to one snapshot/SSE pair.
  const generation = useRef(0),
    current = useRef<ChatSnapshot | null>(null),
    pending = useRef<StartRunInput | null>(null),
    sending = useRef(false);
  const abort = useRef<AbortController | null>(null),
    disconnect = useRef<(() => void) | null>(null),
    revision = useRef(0);
  const publish = useCallback((value: ChatSnapshot | null) => {
    current.current = value;
    setSnapshot(value);
  }, []);
  const refresh = useCallback(async () => {
    if (!chatId || activeChat.current !== chatId) return;
    const gen = generation.current,
      version = ++revision.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    disconnect.current?.();
    disconnect.current = null;
    try {
      const value = await api.snapshot(chatId, controller.signal);
      if (
        gen !== generation.current ||
        version !== revision.current ||
        activeChat.current !== chatId
      )
        return;
      publish(value);
      setError(null);
      if (value.run?.status === "running") {
        disconnect.current = connectEvents(
          value.run.id,
          value.lastEventId,
          (event) => {
            if (
              gen !== generation.current ||
              version !== revision.current ||
              activeChat.current !== chatId
            )
              return;
            const previous = current.current;
            if (
              !previous ||
              event.chatId !== chatId ||
              event.runId !== previous.run?.id
            )
              return;
            if (event.id <= previous.lastEventId) return;
            if (event.id !== previous.lastEventId + 1) {
              void refresh();
              return;
            }
            try {
              publish(reduceChat(previous, event));
              setError(null);
            } catch {
              void refresh();
            }
          },
          () => {
            if (
              gen === generation.current &&
              version === revision.current &&
              activeChat.current === chatId
            )
              setError("Связь прервана. Восстанавливаем поток…");
          },
        );
      }
    } catch (e) {
      if (gen === generation.current && !controller.signal.aborted)
        setError(
          e instanceof HttpError ? e.message : "Не удалось загрузить диалог.",
        );
    }
  }, [chatId, publish]);
  useEffect(() => {
    generation.current++;
    pending.current = null;
    sending.current = false;
    publish(null);
    setError(null);
    setLoading(Boolean(chatId));
    const gen = generation.current;
    void refresh().finally(() => {
      if (gen === generation.current) setLoading(false);
    });
    return () => {
      generation.current++;
      abort.current?.abort();
      disconnect.current?.();
    };
  }, [refresh, chatId, publish]);
  const submit = async (input: StartRunInput) => {
    if (activeChat.current !== chatId) return;
    if (sending.current || current.current?.run?.status === "running")
      throw new Error("Диалог занят");
    const gen = generation.current;
    sending.current = true;
    // Keep this exact ID/text pair until acceptance or a definite client rejection.
    pending.current = input;
    setLoading(true);
    setError(null);
    try {
      await api.startRun(chatId, input);
      if (gen !== generation.current) return;
      pending.current = null;
      await refresh();
    } catch (e) {
      if (gen !== generation.current) return;
      if (e instanceof HttpError && e.statusCode >= 400 && e.statusCode < 500)
        pending.current = null;
      setError(
        e instanceof HttpError
          ? e.message
          : "Ответ сервера не получен. Повторите отправку с тем же сообщением.",
      );
      if (e instanceof HttpError && e.statusCode === 409) await refresh();
      throw new Error("Сообщение не подтверждено");
    } finally {
      if (gen === generation.current) {
        sending.current = false;
        setLoading(false);
      }
    }
  };
  return {
    snapshot,
    loading,
    error,
    send: async (text: string) => {
      if (pending.current) throw new Error("Повторите предыдущую отправку");
      if (!text.trim()) return;
      await submit({ text: text.trim(), clientRequestId: crypto.randomUUID() });
    },
    retrySend: async () => {
      if (pending.current) await submit(pending.current);
    },
    stop: async () => {
      if (activeChat.current !== chatId) return;
      const gen = generation.current;
      const id = current.current?.run?.id;
      if (id)
        try {
          await api.abortRun(id);
          await refresh();
        } catch {
          if (gen === generation.current)
            setError("Не удалось остановить запуск. Попробуйте ещё раз.");
        }
    },
    refresh,
    retryPending: Boolean(pending.current),
  };
}
