import type { ChatSnapshot, MessageView } from './domain.js';
import type { CrewEvent } from './events.js';

export function reduceChat(snapshot: ChatSnapshot, event: CrewEvent): ChatSnapshot {
  if (snapshot.chat.id !== event.chatId || snapshot.run?.id !== event.runId || event.id <= snapshot.lastEventId) {
    return snapshot;
  }

  const next = structuredClone(snapshot);
  const data = event.data;
  const upsertMessage = (message: MessageView, preserveExisting: boolean) => {
    const index = next.messages.findIndex(item => item.id === message.id);
    if (index < 0) next.messages.push(structuredClone(message));
    else if (!preserveExisting) next.messages[index] = structuredClone(message);
  };

  switch (data.type) {
    case 'message.started':
      upsertMessage(data.message, true);
      break;
    case 'message.completed':
      upsertMessage(data.message, false);
      break;
    case 'message.delta': {
      const message = next.messages.find(item => item.id === data.messageId);
      if (!message) throw new Error(`Missing message ${data.messageId} for delta`);
      message.text += data.delta;
      break;
    }
    case 'tool.started': {
      const message = next.messages.find(item => item.id === data.messageId);
      if (!message) throw new Error(`Missing message ${data.messageId} for tool event`);
      const toolIndex = message.tools.findIndex(tool => tool.id === data.tool.id);
      if (toolIndex < 0) message.tools.push(structuredClone(data.tool));
      else message.tools[toolIndex] = structuredClone(data.tool);
      break;
    }
    case 'tool.completed': {
      const message = next.messages.find(item => item.id === data.messageId);
      if (!message) throw new Error(`Missing message ${data.messageId} for tool event`);
      const toolIndex = message.tools.findIndex(tool => tool.id === data.tool.id);
      if (toolIndex < 0) throw new Error(`Missing tool ${data.tool.id} for completion`);
      message.tools[toolIndex] = structuredClone(data.tool);
      break;
    }
    case 'todos.changed':
      next.todos = structuredClone(data.todos);
      break;
    case 'run.finished':
      next.run = structuredClone(data.run);
      for (const message of next.messages) {
        if (message.state === 'streaming') message.state = 'interrupted';
        for (const tool of message.tools) {
          if (tool.state === 'running') tool.state = 'interrupted';
        }
      }
      break;
  }

  next.lastEventId = event.id;
  return next;
}
