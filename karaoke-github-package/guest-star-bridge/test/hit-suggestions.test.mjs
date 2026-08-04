import assert from "node:assert/strict";
import test from "node:test";
import { selectHitSuggestions } from "../src/hit-suggestions.mjs";

test("equilibra el Plan B entre español e inglés", () => {
  const suggestions = selectHitSuggestions([], [], "activity-balanced", 6);
  const languages = suggestions.map((item) => item.language);

  assert.equal(languages.filter((item) => item === "English").length, 3);
  assert.equal(languages.filter((item) => item === "Español").length, 3);
  assert.notEqual(languages[0], languages[1]);
});

test("da prioridad inicial al idioma más solicitado sin perder el equilibrio", () => {
  const suggestions = selectHitSuggestions(
    [{ language: "English" }, { language: "English" }],
    [],
    "activity-english",
    6
  );

  assert.equal(suggestions[0].language, "English");
  assert.equal(
    suggestions.filter((item) => item.language === "English").length,
    3
  );
});
