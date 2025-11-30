type DatabaseAction<T> = (database: IDBDatabase) => T;

export class WrappedDatabase {
  private actionBuffer: DatabaseAction<any>[];
  private connection: IDBDatabase | null;

  constructor(name: string, setup: DatabaseAction<void>) {
    this.actionBuffer = [];
    this.connection = null;

    const request = indexedDB.open(name, 1);

    request.onsuccess = (event) => {
      // @ts-expect-error
      this.connection = event.target.result;
      this.emptyBuffer();
    };

    request.onupgradeneeded = (event) => {
      // @ts-expect-error
      setup(event.target.result!);
    };
  }

  private emptyBuffer() {
    for (const action of this.actionBuffer) {
      action(this.connection!);
    }
  }

  private withDB<T>(callback: DatabaseAction<Promise<T>>): Promise<T> {
    if (this.connection === null) {
      let resolve!: (value: T) => void;
      this.actionBuffer.push((connection) => callback(connection).then(resolve));

      return new Promise<T>((res) => (resolve = res));
    }

    return Promise.resolve(callback(this.connection));
  }

  public query<T>(table: string, key: string): Promise<T> {
    return this.withDB<T>((db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(table, "readonly").objectStore(table).get(key);

        transaction.onsuccess = (event) => {
          // @ts-expect-error
          resolve(event.target.result);
        };

        transaction.onerror = () => {
          reject("Transaction failed to execute.");
        };
      });
    });
  }

  public queryAll<T>(table: string): Promise<T[]> {
    return this.withDB<T[]>((db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(table, "readonly").objectStore(table).getAll();

        transaction.onsuccess = (event) => {
          // @ts-expect-error
          resolve(event.target.result);
        };

        transaction.onerror = () => {
          reject("Transaction failed to execute.");
        };
      });
    });
  }

  public put(table: string, item: unknown): Promise<void> {
    return this.withDB((db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(table, "readwrite").objectStore(table).put(item);

        transaction.onsuccess = () => resolve();
        transaction.onerror = () => reject("Transaction failed to execute.");
      });
    });
  }

  public delete(table: string, key: string): Promise<void> {
    return this.withDB((db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(table, "readwrite").objectStore(table).delete(key);

        transaction.onsuccess = () => resolve();
        transaction.onerror = () => reject("Transaction failed to execute.");
      });
    });
  }
}

export let database: WrappedDatabase = new WrappedDatabase("open-ollama-ui", (database) => {
  database.createObjectStore("chats", { keyPath: "id" });
  database.createObjectStore("chat-data", { keyPath: "id" });
  database.createObjectStore("preferences", { keyPath: "name" });
});
