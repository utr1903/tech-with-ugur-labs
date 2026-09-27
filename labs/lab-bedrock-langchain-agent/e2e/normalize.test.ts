import { describe, expect, it } from "vitest";
import { answerContains, normalize } from "./normalize.js";

describe("normalize", () => {
  it("lowers case, collapses whitespace and removes currency formatting", () => {
    expect(normalize("  The price is  $1,234.50 USD ")).toBe(
      "the price is 1234.50",
    );
  });

  it("removes markdown emphasis", () => {
    expect(normalize("**Ann Lee** ordered `3`")).toBe("ann lee ordered 3");
  });

  it("treats a non-breaking space as a space", () => {
    expect(normalize("Ann Lee ordered")).toBe("ann lee ordered");
  });

  it("treats a narrow no-break space as a space", () => {
    expect(normalize("Ann Lee ordered")).toBe("ann lee ordered");
  });

  it("treats curly single quotes as straight quotes", () => {
    expect(normalize("‘Ann Lee’")).toBe("'ann lee'");
  });

  it("treats curly double quotes as straight quotes", () => {
    expect(normalize("“Ann Lee”")).toBe('"ann lee"');
  });
});

describe("answerContains", () => {
  it("finds text in any letter case", () => {
    expect(
      answerContains(
        "Her email is Ann.Lee@Example.com.",
        "ann.lee@example.com",
      ),
    ).toBe(true);
  });

  it("finds a price however the model formats the currency", () => {
    for (const answer of [
      "It costs $123.45.",
      "123.45 USD",
      "USD 123.45",
      "**$123.45**",
    ]) {
      expect(answerContains(answer, "123.45")).toBe(true);
    }
  });

  it("finds a price above one thousand written with a separator", () => {
    expect(answerContains("It costs $1,234.50.", "1234.50")).toBe(true);
  });

  it("does not find a number inside another number", () => {
    for (const answer of [
      "There are 14 customers.",
      "It is 4.50.",
      "In 2024.",
      "41",
      "0.4",
    ]) {
      expect(answerContains(answer, "4")).toBe(false);
    }
  });

  it("finds a number at the start, the end, and before punctuation", () => {
    for (const answer of [
      "4",
      "4 customers",
      "The count is 4.",
      "Count: 4, all in Vienna",
      "(4)",
    ]) {
      expect(answerContains(answer, "4")).toBe(true);
    }
  });

  it("does not find a price inside a longer number", () => {
    expect(answerContains("It costs 1123.45.", "123.45")).toBe(false);
    expect(answerContains("It costs 123.456.", "123.45")).toBe(false);
  });

  it("finds nothing in an empty answer", () => {
    expect(answerContains("", "4")).toBe(false);
  });

  it("treats regular expression characters in the expected text literally", () => {
    expect(answerContains("Product A+ (2 pack)", "a+ (2 pack)")).toBe(true);
    expect(answerContains("Product AAA", "a+")).toBe(false);
  });
});
