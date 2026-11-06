import { describe, expect, it } from "vitest";

import { ListingCategoryValidationError, validateListingCategory } from "./listing-category";
import type { ListingCategory } from "./listing-category";

/**
 * A category that satisfies every rule, used as the base for each refusal case so that only the
 * member under test differs.
 */
const validCategory: ListingCategory = {
  slug: "logistics-tools",
  name: "Logistics tools",
  description: "Agents that plan, track and reconcile shipments.",
};

/** Runs the guard and returns the typed refusal, failing the test if it did not throw one. */
function catchSeamError(candidate: unknown): ListingCategoryValidationError {
  try {
    validateListingCategory(candidate);
  } catch (error) {
    if (error instanceof ListingCategoryValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected validateListingCategory to refuse the candidate");
}

describe("validateListingCategory", () => {
  it.each([
    "aa",
    "a1",
    "a--b",
    "ab-",
    "logistics-tools",
    "customer-support",
    "data-pipelines",
    "document-processing",
    "x".repeat(32),
  ])("accepts the slug %s", (slug) => {
    const candidate = { ...validCategory, slug };

    const validated = validateListingCategory(candidate);

    expect(validated).toBe(candidate);
    expect(Object.isFrozen(validated)).toBe(false);
    expect(validated.slug).toBe(slug);
  });

  it.each([
    "a",
    "x".repeat(33),
    "Logistics-tools",
    "LOGISTICS-TOOLS",
    "1logistics",
    "-logistics",
    "logistics_tools",
    "logistics tools",
    "logistics.tools",
    "",
  ])("refuses the slug %s", (slug) => {
    const error = catchSeamError({ ...validCategory, slug });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ListingCategoryValidationError);
    expect(error.name).toBe("ListingCategoryValidationError");
    expect(error.code).toBe("seam_validation");
    expect(error.field).toBe("slug");
    expect(error.message).toContain("slug");
    expect(error.message).toContain("ListingCategory");
  });

  it.each([null, undefined, 42, "logistics-tools", true])(
    "refuses the non-object candidate %o on slug",
    (candidate) => {
      const error = catchSeamError(candidate);

      expect(error.code).toBe("seam_validation");
      expect(error.field).toBe("slug");
      expect(error.message).toContain("slug");
    },
  );

  it.each([{ name: "" }, { name: "   " }, { name: 42 }, { name: null }])(
    "refuses the name %o",
    (override) => {
      const error = catchSeamError({ ...validCategory, ...override });

      expect(error.name).toBe("ListingCategoryValidationError");
      expect(error.code).toBe("seam_validation");
      expect(error.field).toBe("name");
      expect(error.message).toContain("name");
      expect(error.message).toContain("ListingCategory");
    },
  );

  it.each([{ description: "" }, { description: "   " }, { description: 42 }, { description: null }])(
    "refuses the description %o",
    (override) => {
      const error = catchSeamError({ ...validCategory, ...override });

      expect(error.name).toBe("ListingCategoryValidationError");
      expect(error.code).toBe("seam_validation");
      expect(error.field).toBe("description");
      expect(error.message).toContain("description");
      expect(error.message).toContain("ListingCategory");
    },
  );

  it("refuses a candidate whose name is absent", () => {
    const error = catchSeamError({
      slug: validCategory.slug,
      description: validCategory.description,
    });

    expect(error.code).toBe("seam_validation");
    expect(error.field).toBe("name");
  });

  it("refuses a candidate whose description is absent", () => {
    const error = catchSeamError({ slug: validCategory.slug, name: validCategory.name });

    expect(error.code).toBe("seam_validation");
    expect(error.field).toBe("description");
  });

  it.each([
    { slug: "Bad", name: "" },
    { slug: "a", name: "   " },
    { slug: "logistics_tools", description: "" },
  ])("reports the first failing field for %o", (override) => {
    const error = catchSeamError({ ...validCategory, ...override });

    expect(error.field).toBe("slug");
  });

  it("reports name before description when both are empty", () => {
    const error = catchSeamError({ ...validCategory, name: "  ", description: "  " });

    expect(error.field).toBe("name");
  });

  it("returns the same object without rewriting padded text members", () => {
    const candidate = {
      slug: "document-processing",
      name: "  Document processing  ",
      description: "  Agents that extract structure from documents.  ",
    };

    const validated = validateListingCategory(candidate);

    expect(validated).toBe(candidate);
    expect(validated.name).toBe("  Document processing  ");
    expect(validated.description).toBe("  Agents that extract structure from documents.  ");
  });

  it("leaves extra properties untouched", () => {
    const candidate = { ...validCategory, seededRowId: "category-logistics-tools" };

    const validated = validateListingCategory(candidate);

    expect(validated).toBe(candidate);
    expect(validated).toHaveProperty("seededRowId", "category-logistics-tools");
  });

  it("names the offending field in the message it composes", () => {
    const error = catchSeamError({ ...validCategory, name: "" });

    expect(error.message).toBe('ListingCategory field "name" must be a non-empty string.');
  });
});
