import { DefaultChatTransport } from "ai";
import type { ChatMessage } from "../components/MessageView";
export const transport = new DefaultChatTransport<ChatMessage>({
  api: "/api/agent",
  fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (!response.ok) {
      let message = "Unable to start the response.";
      try {
        message = (await response.json()).error ?? message;
      } catch {}
      throw new Error(message);
    }
    return response;
  },
  prepareSendMessagesRequest: ({ body }) => ({ body: body ?? {} }),
});
