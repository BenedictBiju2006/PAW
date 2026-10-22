import "server-only";
import type { Store } from "./contracts";
export class TextJournal {
  private fragment = "";
  private textIndex = 0;
  constructor(
    private store: Store,
    private turnId: string,
  ) {}
  get size() {
    return this.fragment.length;
  }
  append(text: string) {
    this.fragment += text;
  }
  async flush() {
    while (this.fragment) {
      const chunk = this.fragment.slice(0, 15000);
      await this.store.event(
        this.turnId,
        `text:${this.textIndex}`,
        "assistant",
        [{ type: "text", text: chunk }],
      );
      this.textIndex++;
      this.fragment = this.fragment.slice(chunk.length);
    }
  }
}
