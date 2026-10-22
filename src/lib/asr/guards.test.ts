import { describe, expect, it } from "vitest";
import type { Word } from "../types";
import { applyGuards, dropPromptEcho, dropRepeats, isHallucination, maxNewTokens } from "./guards";

const ws = (text: string): Word[] => text.split(" ").map((w, i) => ({ w, s: i, e: i + 0.5 }));
const txt = (w: Word[]) => w.map((x) => x.w).join(" ");

describe("dropRepeats", () => {
  it("collapses decoder loops", () => {
    expect(txt(dropRepeats(ws("wir haben ein, ein, ein, ein, ein, ein, ein, Roboter")))).toBe("wir haben ein, Roboter");
    expect(txt(dropRepeats(ws("das ist gut das ist gut das ist gut das ist gut ok")))).toBe("das ist gut ok");
    expect(txt(dropRepeats(ws("ähm, ähm, ähm, ähm, ähm, also")))).toBe("ähm, also");
  });
  it("keeps natural repetition", () => {
    const s = "ja ja ja genau, äh, äh, das war es, das war es";
    expect(txt(dropRepeats(ws(s)))).toBe(s);
  });
});

describe("isHallucination", () => {
  it("drops subtitle credits and outros on near-silence", () => {
    expect(isHallucination(" Untertitel im Auftrag des ZDF, 2020", 0.8)).toBe(true);
    expect(isHallucination(" Amen.", 0.5)).toBe(true);
    expect(isHallucination(" Thank you for watching!", 1)).toBe(true);
    expect(isHallucination("", 3)).toBe(true);
  });
  it("keeps real speech", () => {
    expect(isHallucination(" Vielen Dank.", 2.5)).toBe(false);
    expect(isHallucination(" Unsere Seite ist www.beispiel.com", 3)).toBe(false);
  });
});

describe("dropPromptEcho", () => {
  it("removes a verbatim echo of the filler prompt", () => {
    const w = ws("Ähm, also, äh, ich hab, ähm, gedacht, Roboter");
    expect(txt(dropPromptEcho(w, "de"))).toBe("Roboter");
  });
  it("keeps short prompt-like phrases", () => {
    const s = "also, äh, ich hab gedacht";
    expect(txt(applyGuards(ws(s), "de"))).toBe(s);
  });
});

describe("maxNewTokens", () => {
  it("scales with duration and respects Whisper's 448 positions", () => {
    expect(maxNewTokens(10, 30)).toBe(102);
    expect(maxNewTokens(20, 30)).toBe(192);
    expect(maxNewTokens(60, 30)).toBe(417);
    expect(maxNewTokens(0.1, 30)).toBeGreaterThanOrEqual(8);
  });
});
