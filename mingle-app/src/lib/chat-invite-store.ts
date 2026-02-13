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

function namespacedKey(baseKey: string, namespace?: string): string {
  const normalized = namespace?.trim();
  if (!normalized) {
    return baseKey;
  }
  return `${baseKey}__${normalized}`;
}

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

export function loadSavedConversations(namespace?: string): SavedConversation[] {
  if (typeof window === "undefined") {
    return [];
  }
  return safeParse<SavedConversation[]>(
    window.localStorage.getItem(namespacedKey(CONVERSATION_STORAGE_KEY, namespace)),
    [],
  );
}

export function saveConversations(conversations: SavedConversation[], namespace?: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    namespacedKey(CONVERSATION_STORAGE_KEY, namespace),
    JSON.stringify(conversations),
  );
}

export function loadInviteRecords(namespace?: string): InviteRecord[] {
  if (typeof window === "undefined") {
    return [];
  }
  return safeParse<InviteRecord[]>(
    window.localStorage.getItem(namespacedKey(INVITE_STORAGE_KEY, namespace)),
    [],
  );
}

export function saveInviteRecords(invites: InviteRecord[], namespace?: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(namespacedKey(INVITE_STORAGE_KEY, namespace), JSON.stringify(invites));
}

export function createInviteToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replaceAll("-", "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
