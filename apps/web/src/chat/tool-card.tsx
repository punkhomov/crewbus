import type { ToolView } from "@crewbus/contracts";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
const titles: Record<string, string> = {
  todo_create: "Создание задачи",
  todo_list: "Список задач",
  todo_update: "Обновление задачи",
  todo_delete: "Удаление задачи",
};
export function ToolCard({ tool }: { tool: ToolView }) {
  const state =
    tool.state === "completed"
      ? "output-available"
      : tool.state === "failed"
        ? "output-error"
        : "input-available";
  return (
    <Tool>
      {tool.state === "interrupted" ? (
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-3 text-sm">
          <span>{titles[tool.name] ?? tool.name}</span>
          <Badge variant="secondary">Прервано</Badge>
        </CollapsibleTrigger>
      ) : (
        <ToolHeader
          type="dynamic-tool"
          toolName={tool.name}
          title={titles[tool.name] ?? tool.name}
          state={state}
        />
      )}
      <ToolContent>
        <ToolInput input={tool.input} />
        {tool.state === "completed" && (
          <ToolOutput output={tool.output} errorText={undefined} />
        )}{" "}
        {tool.state === "failed" && (
          <ToolOutput
            output={undefined}
            errorText={tool.error ?? "Не удалось выполнить инструмент"}
          />
        )}
      </ToolContent>
    </Tool>
  );
}
