/**
 * Tracks the small bit of state a streamed text/thinking delta needs:
 * which kind (if any) is currently open, so consecutive deltas of the
 * same kind keep appending instead of opening a new inline block, and
 * whether any delta has been seen at all, so the renderer can skip the
 * duplicate, fully-buffered block Qwen Code also sends once a stream
 * completes. Split out of renderer.ts so its event-dispatch switch can
 * be read without this bookkeeping mixed in.
 */
import { stripControlSequences } from "./sanitize.js";
import type { Style } from "./style.js";

type StreamKind = "none" | "text" | "thinking";

export class StreamState {
  private kind: StreamKind = "none";
  private partials = false;

  /** True once any delta has been written; the renderer skips the buffered block that follows. */
  get sawPartials(): boolean {
    return this.partials;
  }

  /** Writes one streamed delta, opening a new inline block first when the kind changes. */
  write(
    kind: "text" | "thinking",
    text: string,
    emit: (t: string) => void,
    style: Style,
  ): void {
    this.partials = true;
    const clean = stripControlSequences(text);
    if (this.kind !== kind) {
      this.close(emit);
      emit(kind === "text" ? "⏺ " : style.paint("dim", "✻ "));
      this.kind = kind;
    }
    emit(kind === "text" ? clean : style.paint("dim", clean));
  }

  /** Closes any open inline block, writing its trailing newline; a no-op when nothing is open. */
  close(emit: (t: string) => void): void {
    if (this.kind !== "none") {
      emit("\n");
      this.kind = "none";
    }
  }
}
