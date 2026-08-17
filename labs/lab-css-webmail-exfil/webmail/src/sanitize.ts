// Remove the two CSS constructs that can fetch an external resource, which is
// how attacker CSS turns styling into a data channel:
//   - url(...) function calls  (background-image, cursor, etc.)
//   - @import at-rules
// Production code should use a real CSS allow-list parser; this narrow strip is
// enough to close the channel the lab demonstrates.
export function sanitizeCss(css: string): string {
  const withoutImports = css.replace(/@import[^;]*;/gi, "");
  return withoutImports.replace(/url\s*\([^)]*\)/gi, "");
}
