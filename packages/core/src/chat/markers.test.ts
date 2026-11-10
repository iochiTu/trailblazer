import { describe, expect, it } from "vitest";
import { MarkerFilter } from "./markers.js";

function all(chunks: string[]) {
  const filter = new MarkerFilter();
  let text = "";
  const ids: string[] = [];
  const gaps: string[] = [];
  for (const chunk of chunks) {
    const out = filter.push(chunk);
    text += out.text;
    ids.push(...out.ids);
    gaps.push(...out.gaps);
  }
  return { text: text + filter.flush(), ids, gaps };
}
const run = (chunks: string[]) => {
  const { text, ids } = all(chunks);
  return { text, ids };
};

describe("photo markers", () => {
  it("removes markers and reports their ids", () => {
    expect(run(["Here is our patio:\n[[photo:p1]]\nSee you soon!"])).toEqual({
      text: "Here is our patio:\nSee you soon!",
      ids: ["p1"],
    });
  });

  it("handles a marker split across chunks", () => {
    expect(run(["Look ", "[", "[pho", "to:p", "2]", "] there"])).toEqual({
      text: "Look there",
      ids: ["p2"],
    });
  });

  it("never shows a partial marker while streaming", () => {
    const filter = new MarkerFilter();
    expect(filter.push("Our menu [[pho").text).toBe("Our menu ");
    expect(filter.push("to:p1]]").ids).toEqual(["p1"]);
  });

  it("lets ordinary brackets through", () => {
    expect(run(["Links [like this](https://x.test) and [[notes]] ", "stay [", "x"])).toEqual({
      text: "Links [like this](https://x.test) and [[notes]] stay [x",
      ids: [],
    });
    expect(run(["ends with ["]).text).toBe("ends with [");
  });
});

describe("gap markers", () => {
  it("removes the marker and reports what was missing", () => {
    expect(all(["I don't have that information.\n\n[[gap: wedding  cakes ]]"])).toEqual({
      text: "I don't have that information.\n\n",
      ids: [],
      gaps: ["wedding cakes"],
    });
  });

  it("handles a marker split across chunks, next to a photo marker", () => {
    expect(all(["Sorry! [[photo:p1]]\n[", "[ga", "p: prix du ", "traiteur]", "]"])).toEqual({
      text: "Sorry! ",
      ids: ["p1"],
      gaps: ["prix du traiteur"],
    });
  });

  it("never shows a partial marker while streaming, however long the topic", () => {
    const filter = new MarkerFilter();
    expect(filter.push("No idea. [[gap: gluten").text).toBe("No idea. ");
    expect(filter.push("-free options and whether the kitchen is").text).toBe("");
    expect(filter.push(" nut free]]").gaps).toEqual([
      "gluten-free options and whether the kitchen is nut free",
    ]);
  });

  it("reports an empty topic, and leaves look-alikes alone", () => {
    expect(all(["[[gap:]]"]).gaps).toEqual([""]);
    expect(all(["mind the [[gap]] and [[gap: a\nb]]"])).toEqual({
      text: "mind the [[gap]] and [[gap: a\nb]]",
      ids: [],
      gaps: [],
    });
  });
});
