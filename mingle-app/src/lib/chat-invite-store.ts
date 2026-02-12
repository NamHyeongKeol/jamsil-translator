export type ConversationMessage = {
  id: string;
  role: "me" | "partner";
  text: string;
  createdAt: string;
};

export type SavedConversation = {
  id: string;
  roomId: number;
  roomName: string;
  roomAvatar: string;
  summary: string;
  messages: ConversationMessage[];
  savedAt: string;
};

export type InviteRecord = {
  token: string;
  conversationId: string;
  inviterName: string;
  inviteUrl: string;
  createdAt: string;
};

const CONVERSATION_STORAGE_KEY = "mingle_saved_conversations_v1";
const INVITE_STORAGE_KEY = "mingle_invite_records_v1";

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadSavedConversations(): SavedConversation[] {
  if (typeof window === "undefined") {
    return [];
  }
  return safeParse<SavedConversation[]>(
    window.localStorage.getItem(CONVERSATION_STORAGE_KEY),
    [],
  );
}

export function saveConversations(conversations: SavedConversation[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    CONVERSATION_STORAGE_KEY,
    JSON.stringify(conversations),
  );
}

export function loadInviteRecords(): InviteRecord[] {
  if (typeof window === "undefined") {
    return [];
  }
  return safeParse<InviteRecord[]>(
    window.localStorage.getItem(INVITE_STORAGE_KEY),
    [],
  );
}

export function saveInviteRecords(invites: InviteRecord[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(INVITE_STORAGE_KEY, JSON.stringify(invites));
}

export function createInviteToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replaceAll("-", "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
