import { reduceChat, type ChatSnapshot } from '@crewbus/contracts';
import type { Storage } from '../storage/index.js';

export function snapshot(storage: Storage, chatId: string): ChatSnapshot {
  return storage.transaction(() => {
    let view: ChatSnapshot = {chat:storage.chats.get(chatId), todos:[], messages:[], run:null, lastEventId:0};
    for (const run of storage.runs.list(chatId)) {
      const {text, userMessageId} = storage.runs.details(run.id);
      view = {...view, run, lastEventId:0};
      view.messages.push({id:userMessageId,role:'user',text,state:'completed',tools:[]});
      for (const event of storage.events.since(run.id, 0)) view = reduceChat(view, event);
    }
    // Manual edits can be newer than the last agent event.
    view.todos = storage.todos.list(chatId);
    return view;
  });
}
