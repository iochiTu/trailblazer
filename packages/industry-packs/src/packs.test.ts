import { describe, expect, it } from "vitest";
import {
  availablePacks,
  getTemplate,
  hasTemplate,
  isSelectable,
  packs,
  resolveBehavior,
  WORKFLOW_LIMITS,
} from "./index.js";

describe("industry packs", () => {
  it("has unique pack slugs and unique variant slugs per pack", () => {
    const slugs = packs.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const pack of packs) {
      const vs = pack.variants.map((v) => v.slug);
      expect(new Set(vs).size, pack.slug).toBe(vs.length);
    }
  });

  it("launches with the phase-1 packs only", () => {
    expect(availablePacks().map((p) => p.slug)).toEqual([
      "restaurant",
      "cafe-bakery",
      "retail",
      "personal-care",
      "lodging",
      "attractions",
      "generic",
    ]);
  });

  it("marks regulated professions as professional scope", () => {
    for (const slug of [
      "clinic",
      "pharmacy",
      "law-firm",
      "accounting-tax",
      "immigration-consultant",
      "car-dealership",
    ]) {
      expect(packs.find((p) => p.slug === slug)?.scope).toBe("professional");
    }
  });

  it("validates pack and variant selection", () => {
    expect(isSelectable("restaurant")).toBe(true);
    expect(isSelectable("restaurant", "pub")).toBe(true);
    expect(isSelectable("restaurant", "dental")).toBe(false);
    expect(isSelectable("clinic")).toBe(false); // phase 3
    expect(isSelectable("clinic", null, 3)).toBe(true);
    expect(isSelectable("nope")).toBe(false);
  });
});

describe("industry templates", () => {
  it("gives every released industry its own template within the workflow limits", () => {
    for (const pack of availablePacks()) {
      expect(hasTemplate(pack.slug), pack.slug).toBe(true);
      for (const variant of [null, ...pack.variants.map((v) => v.slug)]) {
        const t = getTemplate(pack.slug, variant);
        expect(t.guidelines.length).toBeLessThanOrEqual(WORKFLOW_LIMITS.guidelinesLength);
        expect(t.workflows.length).toBeLessThanOrEqual(WORKFLOW_LIMITS.maxWorkflows);
        const ids = t.workflows.map((w) => w.id);
        expect(new Set(ids).size, `${pack.slug}/${variant}`).toBe(ids.length);
        for (const w of t.workflows) {
          expect(w.name.length).toBeLessThanOrEqual(WORKFLOW_LIMITS.nameLength);
          expect(w.when.length).toBeLessThanOrEqual(WORKFLOW_LIMITS.whenLength);
          expect(w.finish.length).toBeLessThanOrEqual(WORKFLOW_LIMITS.finishLength);
          expect(w.steps.length).toBeGreaterThan(0);
          expect(w.steps.length).toBeLessThanOrEqual(WORKFLOW_LIMITS.maxSteps);
          for (const step of w.steps) expect(step.length).toBeLessThanOrEqual(WORKFLOW_LIMITS.stepLength);
        }
      }
    }
  });

  it("adds variant-only guidelines and workflows", () => {
    expect(getTemplate("retail").workflows.map((w) => w.id)).not.toContain("flower-delivery");
    const florist = getTemplate("retail", "florist");
    expect(florist.workflows.map((w) => w.id)).toContain("flower-delivery");
    expect(florist.guidelines).toContain("cut-off");
    expect(getTemplate("restaurant", "pub").guidelines).toContain("19");
  });

  it("returns fresh copies, so editing one assistant's workflows can't change the template", () => {
    const a = getTemplate("restaurant");
    a.workflows[0]!.steps.push("changed");
    expect(getTemplate("restaurant").workflows[0]!.steps).not.toContain("changed");
  });

  it("falls back to the template for assistants without their own copy", () => {
    const legacy = resolveBehavior({ pack: "lodging", variant: null, guidelines: null, workflows: null });
    expect(legacy).toEqual({
      guidelines: getTemplate("lodging").guidelines,
      workflows: getTemplate("lodging").workflows,
    });
    const own = resolveBehavior({ pack: "lodging", variant: null, guidelines: "Mine", workflows: [] });
    expect(own).toEqual({ guidelines: "Mine", workflows: [] });
  });
});
