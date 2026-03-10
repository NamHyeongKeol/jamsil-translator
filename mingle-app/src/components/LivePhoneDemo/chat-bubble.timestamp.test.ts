import { afterEach, describe, expect, it, vi } from "vitest";
import { formatChatBubbleTimestamp } from "./chat-bubble.timestamp";

describe("formatChatBubbleTimestamp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns localized relative timestamps based on the app locale", () => {
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-03-11T13:06:10+09:00").getTime(),
    );
    const createdAtMs = new Date("2026-03-11T13:06:00+09:00").getTime();

    expect(formatChatBubbleTimestamp(createdAtMs, "ko")).toContain("전");
    expect(formatChatBubbleTimestamp(createdAtMs, "en")).toContain("ago");
  });

  it("returns an empty string for missing timestamps", () => {
    expect(formatChatBubbleTimestamp(undefined, "ko")).toBe("");
  });
});
