/** 聊天共享件（chat / chatbot / copilot 三页去重复用，ARCHITECTURE.md Phase E）。 */

export {
  formatContext,
  MODEL_ABBR,
  modelAbbr,
  newChatId,
  SwitchTextStyle,
} from './modelRegistry';
export {
  CHAT_API_URL,
  CHAT_COMPLETIONS_URL,
  createChatProvider,
} from './provider';
export { ChatKitThink } from './Think';
