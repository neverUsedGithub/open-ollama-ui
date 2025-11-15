export interface DBQueryResult {
  key: number;
  score: number;
}

export interface DBSerializedData {
  keys: number[];
  vectors: number[][];
}

export class VectorDB {
  private vectors: Float32Array[] = [];
  private keys: number[] = [];

  private cosineSim(vectorA: Float32Array, vectorB: Float32Array): number {
    let dot = 0;
    for (let i = 0; i < vectorA.length; i++) dot += vectorA[i] * vectorB[i];
    return dot;
  }

  private normalizeVector(vector: Float32Array) {
    let magnitude = 0;

    for (let i = 0; i < vector.length; i++) {
      magnitude += vector[i] * vector[i];
    }

    magnitude = Math.sqrt(magnitude);
    if (magnitude === 0) return;

    for (let i = 0; i < vector.length; i++) {
      vector[i] = vector[i] / magnitude;
    }
  }

  serialize(): DBSerializedData {
    return { keys: Array.from(this.keys), vectors: this.vectors.map((v) => Array.from(v)) };
  }

  load(data: DBSerializedData) {
    this.keys = data.keys;
    this.vectors = data.vectors.map((v) => new Float32Array(v));
  }

  add(key: number, vectors: Float32Array[]) {
    for (let i = 0; i < vectors.length; i++) {
      this.normalizeVector(vectors[i]);

      this.keys.push(key);
      this.vectors.push(vectors[i]);
    }
  }

  query(query: Float32Array, topK: number): DBQueryResult[] {
    this.normalizeVector(query);

    const top: { key: number; score: number }[] = [];
    for (let i = 0; i < this.vectors.length; i++) {
      const score = this.cosineSim(this.vectors[i], query);

      if (top.length < topK) {
        top.push({ key: this.keys[i], score });
        top.sort((a, b) => a.score - b.score);
      } else if (score > top[0].score) {
        top[0] = { key: this.keys[i], score };
        top.sort((a, b) => a.score - b.score);
      }
    }

    return top.sort((a, b) => b.score - a.score);
  }
}

export async function createDatabase(): Promise<VectorDB> {
  return new VectorDB();
}
