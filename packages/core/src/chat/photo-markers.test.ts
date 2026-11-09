import { describe, expect, it } from "vitest";
import { PhotoMarkerFilter } from "./photo-markers.js";

function run(chunks: string[]) {
  const filter = new PhotoMarkerFilter();
  let text = "";
  const ids: string[] = [];
  for (const chunk of chunks) {
    const out = filter.push(chunk);
    text += out.text;
    ids.push(...out.ids);
  }
  return { text: text + filter.flush(), ids };
}

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
    const filter = new PhotoMarkerFilter();
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
