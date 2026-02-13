import rawSeed from "../../data/seed/mingle-seed.json";
import type {
  ConversationMessage,
  InviteRecord,
  SavedConversation,
} from "@/lib/chat-invite-store";

type RawSeed = {
  users: Array<{
    id: string;
    name: string;
    handle: string;
  }>;
  conversations: Array<{
    id: string;
    roomId: number;
    roomName: string;
    roomAvatar: string;
    summary: string;
    messages: string[];
  }>;
};

function toMessages(messages: string[]): ConversationMessage[] {
  const now = Date.now();
  return messages.map((text, index) => {
    const role: "partner" | "me" = index % 2 === 0 ? "partner" : "me";
    return {
      id: `seed_msg_${index + 1}`,
      role,
      text,
      createdAt: new Date(now - (messages.length - index) * 60000).toISOString(),
    };
  });
}

export function getSeedDataset(args: {
  locale: string;
  inviterHandle: string;
  baseOrigin?: string;
}): {
  conversations: SavedConversation[];
  invites: InviteRecord[];
} {
  const seed = rawSeed as RawSeed;
  const origin = args.baseOrigin ?? "https://app.mingle.local";

  const conversations: SavedConversation[] = seed.conversations.map((conversation, index) => ({
    id: conversation.id,
    roomId: conversation.roomId,
    roomName: conversation.roomName,
    roomAvatar: conversation.roomAvatar,
    summary: conversation.summary,
    messages: toMessages(conversation.messages),
    savedAt: new Date(Date.now() - index * 120000).toISOString(),
  }));

  const invites: InviteRecord[] = conversations.map((conversation, index) => {
    const token = `seed_${conversation.roomId}_${index + 1}`;
    return {
      token,
      conversationId: conversation.id,
      inviterName: args.inviterHandle,
      inviteUrl: `${origin}/${args.locale}/invite/${token}`,
      createdAt: new Date(Date.now() - index * 90000).toISOString(),
    };
  });

  return {
    conversations,
    invites,
  };
}
