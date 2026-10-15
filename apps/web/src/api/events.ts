import type { CrewEvent } from "@crewbus/contracts";
export function connectEvents(
  runId: string,
  after: number,
  onEvent: (event: CrewEvent) => void,
  onError: () => void,
): () => void {
  // Native reconnect carries Last-Event-ID; cleanup disconnects without aborting the run.
  const source = new EventSource(
    `/api/runs/${encodeURIComponent(runId)}/events?after=${after}`,
  );
  const listener = (message: MessageEvent<string>) => {
    let event: CrewEvent;
    try {
      event = JSON.parse(message.data) as CrewEvent;
    } catch {
      onError();
      return;
    }
    onEvent(event);
    if (event.data.type === "run.finished") source.close();
  };
  source.addEventListener("crewbus", listener);
  source.onerror = () => onError();
  return () => {
    source.removeEventListener("crewbus", listener);
    source.onerror = null;
    source.close();
  };
}
