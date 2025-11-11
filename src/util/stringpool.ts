export class StringPool {
  private pool: Map<string, number>;

  constructor() {
    this.pool = new Map();
  }

  public add(text: string): number {
    if (!this.pool.has(text)) {
      this.pool.set(text, this.pool.size);
    }

    return this.pool.get(text)!;
  }

  public check(text: string): number {
    return this.pool.get(text) ?? -1;
  }

  public finalize(): string[] {
    return Array.from(this.pool.keys());
  }
}
