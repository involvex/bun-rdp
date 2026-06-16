import { MessageType, type RdpMessage } from '../packages/core-protocol';

export function handleMessage(clientId: string, msg: RdpMessage) {
  switch (msg.type) {
    case MessageType.PING:
      return { type: MessageType.PING, timestamp: Date.now() };
    case MessageType.CLIPBOARD:
      console.log(`[protocol] Clipboard sync from ${clientId}:`, msg.data.slice(0, 80));
      return null;
    default:
      return null;
  }
}
