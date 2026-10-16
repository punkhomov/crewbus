import { expect, test } from "vitest";
import { highlightCode } from "../src/components/ai-elements/code-block.js";
test("same length tool outputs with different middles retain their own highlighted content", async () => {
  const code = (value: string) =>
    JSON.stringify({ prefix: "p".repeat(120), value, suffix: "s".repeat(120) });
  const first = code("first"),
    second = code("other");
  const highlight = (input: string) =>
    new Promise<string>((resolve) => {
      const finish = (result: NonNullable<ReturnType<typeof highlightCode>>) =>
        resolve(
          result.tokens
            .map((line) => line.map((token) => token.content).join(""))
            .join("\n"),
        );
      const cached = highlightCode(input, "json", finish);
      if (cached) finish(cached);
    });
  expect(await highlight(first)).toBe(first);
  expect(await highlight(second)).toBe(second);
});
