/**
 * Flatten a V2 tool result's content to the text a hook reasons about (B295).
 *
 * A V2 result carries structured content — `string` or an array of text and file parts —
 * while the after-hooks want the words the tool reported. Both the PCP warning and the
 * format failure notice need exactly this, so it lives here rather than in either plugin:
 * two copies would be free to disagree about what a result says.
 */
export function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text: unknown }).text)
        : "",
    )
    .join("");
}
