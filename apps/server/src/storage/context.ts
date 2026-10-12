import type { CrewAgentOptions } from '@crewbus/agent';
import type { JsonValue } from '@crewbus/contracts';
import type { RunRepository } from '../chats/repository.js';
import { invalid } from '../lib/error.js';

export type AgentMessage = CrewAgentOptions['messages'][number];

export function loadContext(runs: RunRepository, chatId: string, beforeRunId: string): AgentMessage[] {
  const details = runs.details(beforeRunId);
  if (details.run.chatId !== chatId) invalid('Run does not belong to chat');
  const messages = runs.messages(chatId);
  const boundary = messages.find(m => m.id === details.userMessageId)!;
  return messages.filter(m => m.ordinal < boundary.ordinal).map(m => m.canonical as unknown as AgentMessage);
}

export function saveMessage(runs: RunRepository, chatId: string, runId: string | null, messageId: string, message: AgentMessage): void {
  // Never persist raw provider diagnostics: providers may include credentials in them.
  const canonical = structuredClone(message);
  if (canonical.role === 'assistant' && canonical.errorMessage) canonical.errorMessage = 'Provider request failed';
  runs.saveMessage({id:messageId, chatId, runId, role:canonical.role, canonical:canonical as unknown as JsonValue});
}
