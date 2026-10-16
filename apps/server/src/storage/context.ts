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
  const prior = messages.filter(m => m.ordinal < boundary.ordinal);
  const context: AgentMessage[] = [];
  for (let i = 0; i < prior.length; i++) {
    const stored = prior[i]!;
    const message = stored.canonical as unknown as AgentMessage;
    // Results are admitted only as a complete, adjacent group with their caller.
    if (message.role === 'toolResult') continue;
    if (message.role !== 'assistant') { context.push(message); continue; }
    const results: AgentMessage[] = [];
    while (prior[i + 1]?.role === 'toolResult') {
      const result = prior[++i]!;
      if (result.runId === stored.runId) results.push(result.canonical as unknown as AgentMessage);
    }
    if (message.stopReason === 'aborted' || message.stopReason === 'error') continue;
    const calls = message.content.filter(block => block.type === 'toolCall');
    const coherent = calls.length === results.length && new Set(calls.map(call => call.id)).size === calls.length && calls.every(call =>
      results.filter(result => result.role === 'toolResult' && result.toolCallId === call.id && result.toolName === call.name).length === 1);
    if (coherent) context.push(message, ...results);
  }
  return context;
}

export function saveMessage(runs: RunRepository, chatId: string, runId: string | null, messageId: string, message: AgentMessage): void {
  // Never persist raw provider diagnostics: providers may include credentials in them.
  const canonical = structuredClone(message);
  if (canonical.role === 'assistant' && canonical.errorMessage) canonical.errorMessage = 'Provider request failed';
  runs.saveMessage({id:messageId, chatId, runId, role:canonical.role, canonical:canonical as unknown as JsonValue});
}
