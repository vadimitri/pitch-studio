import { describe, expect, it } from "vitest";
import { cardTimes, cardsTarget, parseCards, splitBudget } from "./host";

describe("splitBudget", () => {
  it("reads mm:ss, seconds and minutes", () => {
    expect(splitBudget("Opening (1:30)")).toEqual({ title: "Opening", budget: 90 });
    expect(splitBudget("Safety [8:00]")).toEqual({ title: "Safety", budget: 480 });
    expect(splitBudget("Bridge (20s)")).toEqual({ title: "Bridge", budget: 20 });
    expect(splitBudget("Reveal (2 min)")).toEqual({ title: "Reveal", budget: 120 });
    expect(splitBudget("Reveal (1,5 min)")).toEqual({ title: "Reveal", budget: 90 });
  });
  it("leaves titles without a budget alone", () => {
    expect(splitBudget("Welcome (all teams)")).toEqual({ title: "Welcome (all teams)" });
  });
});

describe("parseCards", () => {
  it("splits on headings and rules, keeps budgets", () => {
    const cards = parseCards("# Cold open (0:45)\nLights down.\n\n**First line.**\n## Welcome (3:00)\nHi all\n---\nLoose card");
    expect(cards).toEqual([
      { title: "Cold open", body: "Lights down.\n\n**First line.**", budget: 45 },
      { title: "Welcome", body: "Hi all", budget: 180 },
      { title: "", body: "Loose card" },
    ]);
  });
  it("drops empty cards and text before the first heading only if empty", () => {
    expect(parseCards("\n\n# A\nx\n---\n\n---\n# B")).toEqual([{ title: "A", body: "x" }, { title: "B", body: "" }]);
    expect(parseCards("Intro line\n# A\nx")[0]).toEqual({ title: "", body: "Intro line" });
  });
  it("falls back to paragraphs", () => {
    expect(parseCards("Welcome (1:00)\nsay hi\n\nSafety\nthree rules")).toEqual([
      { title: "Welcome", body: "say hi", budget: 60 },
      { title: "Safety", body: "three rules" },
    ]);
  });
  it("handles empty text", () => {
    expect(parseCards("")).toEqual([]);
    expect(parseCards("  \n ")).toEqual([]);
  });
});

describe("cardsTarget", () => {
  it("sums only when every card has a budget", () => {
    expect(cardsTarget([{ title: "a", body: "", budget: 30 }, { title: "b", body: "", budget: 45 }])).toBe(75);
    expect(cardsTarget([{ title: "a", body: "", budget: 30 }, { title: "b", body: "" }])).toBeNull();
    expect(cardsTarget([])).toBeNull();
  });
});

describe("cardTimes", () => {
  it("adds up time per card, going back counts again", () => {
    const r = cardTimes([{ i: 0, t: 0 }, { i: 1, t: 10 }, { i: 0, t: 25 }, { i: 1, t: 30 }, { i: 2, t: 40 }], 50, 4);
    expect(r.used).toEqual([15, 25, 10, 0]);
    expect(r.first).toEqual([0, 10, 40, null]);
  });
  it("clips to the duration and ignores unknown cards", () => {
    const r = cardTimes([{ i: 0, t: 0 }, { i: 7, t: 5 }, { i: 1, t: 8 }], 6, 2);
    expect(r.used).toEqual([5, 0]);
    expect(r.first).toEqual([0, null]);
  });
});
