import type { CrewEvent } from '@crewbus/contracts';

/** Live notifications only. Durable replay belongs to EventRepository. */
export class EventBroker {
  private listeners = new Map<string, Set<(event: CrewEvent) => void>>();

  subscribe(runId: string, listener: (event: CrewEvent) => void): () => void {
    const listeners = this.listeners.get(runId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(runId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(runId);
    };
  }

  publish(event: CrewEvent): void {
    for (const listener of [...(this.listeners.get(event.runId) ?? [])]) {
      // A disconnected transport must not affect the agent or other subscribers.
      try { listener(structuredClone(event)); } catch { /* observer owns transport errors */ }
    }
  }
}
