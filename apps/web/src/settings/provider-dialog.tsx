import { useEffect, useState } from "react";
import type {
  ChatSummary,
  CreateChatInput,
  ModelView,
  ProviderView,
} from "@crewbus/contracts";
import { api } from "../api/client.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
} from "@/components/ui/select";
import {
  ModelSelector as Selector,
  ModelSelectorTrigger,
  ModelSelectorContent,
  ModelSelectorInput,
  ModelSelectorList,
  ModelSelectorGroup,
  ModelSelectorItem,
  ModelSelectorEmpty,
} from "@/components/ai-elements/model-selector";
export function ModelSelector({
  models,
  value,
  onChange,
  disabled = false,
}: {
  models: ModelView[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Selector open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled || !models.length}
          aria-label="Модель"
        >
          {models.find((m) => m.id === value)?.name ?? "Выберите модель"}
        </Button>
      </ModelSelectorTrigger>
      <ModelSelectorContent title="Выберите модель">
        <ModelSelectorInput placeholder="Поиск модели…" />
        <ModelSelectorList>
          <ModelSelectorEmpty>Модели не найдены</ModelSelectorEmpty>
          <ModelSelectorGroup>
            {models.map((model) => (
              <ModelSelectorItem
                key={model.id}
                value={model.id + " " + model.name}
                onSelect={() => {
                  onChange(model.id);
                  setOpen(false);
                }}
              >
                {model.name}
              </ModelSelectorItem>
            ))}
          </ModelSelectorGroup>
        </ModelSelectorList>
      </ModelSelectorContent>
    </Selector>
  );
}
export function ProviderDialog({
  open,
  onOpenChange,
  onCreated,
  onConfigured,
  selection,
  onModelChange,
  onReturnFocus,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onCreated: (chat: ChatSummary) => void;
  onConfigured: () => void;
  selection?: CreateChatInput;
  onModelChange?: (selection: CreateChatInput) => Promise<void>;
  onReturnFocus?: () => void;
}) {
  const [providers, setProviders] = useState<ProviderView[]>([]),
    [providerId, setProviderId] = useState(""),
    [models, setModels] = useState<ModelView[]>([]),
    [modelId, setModelId] = useState(""),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) {
      setKey("");
      return;
    }
    let live = true;
    setError("");
    setProviderId(selection?.providerId ?? "");
    setModelId(selection?.modelId ?? "");
    void api
      .providers()
      .then((items) => {
        if (live) setProviders(items);
      })
      .catch(() => {
        if (live) setError("Не удалось загрузить провайдеров.");
      });
    return () => {
      live = false;
    };
  }, [open, selection?.providerId, selection?.modelId]);
  useEffect(() => {
    setKey("");
    setModels([]);
    if (!providerId) return;
    let live = true;
    void api
      .models(providerId)
      .then((items) => {
        if (live) setModels(items);
      })
      .catch(() => {
        if (live) setError("Не удалось загрузить модели.");
      });
    return () => {
      live = false;
    };
  }, [providerId]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch {
      setError("Не удалось сохранить изменения. Проверьте данные и повторите.");
    } finally {
      setBusy(false);
    }
  };
  const configured = providers.find((p) => p.id === providerId)?.configured;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setKey("");
        onOpenChange(value);
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus?.();
        }}
        className="max-h-[90dvh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>
            {selection ? "Настройки провайдера" : "Новый диалог"}
          </DialogTitle>
          <DialogDescription>
            Выберите провайдера и модель. API-ключ хранится только на сервере.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="provider">Провайдер</Label>
            <Select
              value={providerId}
              onValueChange={(value) => {
                setProviderId(value);
                setModelId("");
              }}
              disabled={busy}
            >
              <SelectTrigger id="provider" className="w-full">
                <SelectValue placeholder="Выберите провайдера" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {providers.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {providerId && (
            <>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="api-key">API-ключ</Label>
                <Badge variant="secondary">
                  {configured ? "Настроен" : "Не настроен"}
                </Badge>
              </div>
              <Input
                id="api-key"
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                disabled={busy}
                placeholder={
                  configured
                    ? "Введите новый ключ для замены"
                    : "Вставьте API-ключ"
                }
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !key.trim()}
                  onClick={() =>
                    void action(async () => {
                      await api.saveKey(providerId, key);
                      setKey("");
                      setProviders(await api.providers());
                      onConfigured();
                    })
                  }
                >
                  Сохранить ключ
                </Button>
                {configured && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await api.deleteKey(providerId);
                        setProviders(await api.providers());
                        onConfigured();
                      })
                    }
                  >
                    Удалить ключ
                  </Button>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Label>Модель</Label>
                <ModelSelector
                  models={models}
                  value={modelId}
                  onChange={setModelId}
                  disabled={busy}
                />
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          {selection && (
            <Button
              disabled={busy || !models.some((m) => m.id === modelId)}
              onClick={() =>
                void action(async () => {
                  await onModelChange?.({ providerId, modelId });
                  onOpenChange(false);
                })
              }
            >
              Сохранить модель
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
          {!selection && (
            <Button
              disabled={
                busy || !providerId || !models.some((m) => m.id === modelId)
              }
              onClick={() =>
                void action(async () => {
                  const chat = await api.createChat({ providerId, modelId });
                  onCreated(chat);
                  onOpenChange(false);
                })
              }
            >
              Создать диалог
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
