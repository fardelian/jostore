/**
 * In-memory drop-in for the subset of node:fs that jostore touches:
 * `mkdirSync`, `readFileSync`, `writeFileSync`.
 *
 * Used by acceptance tests so they never touch the real filesystem
 * (per the project's "tests must use mocks" rule). Behaviour matches
 * Node's sync fs closely enough for jostore's per-key file layout:
 * - Reading a missing file throws ENOENT.
 * - `readFileSync` honours an explicit encoding by returning a string.
 * - `writeFileSync` overwrites prior contents.
 */

function enoent(action: string, path: string): NodeJS.ErrnoException {
    const err = new Error(`ENOENT: no such file or directory, ${action} '${path}'`) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    return err;
}

export class MockFs {
    files = new Map<string, Buffer>();

    /**
     * Test hook: if set, the next call to `readFileSync` consumes this error
     * and throws it instead of running normally. Lets tests cover the
     * non-ENOENT branch in `_readKey` without monkey-patching the mock.
     */
    nextReadFileSyncError: NodeJS.ErrnoException | null = null;

    /**
     * Test hook: if set, the next call to `writeFileSync` throws this error.
     * Used to exercise `_runExitCleanup`'s catch block (which still has a
     * disk-touching `_nextBlock` call inside its template string).
     */
    nextWriteFileSyncError: Error | null = null;

    /** Wipe file contents and clear pending error hooks. */
    reset(): void {
        this.files.clear();
        this.nextReadFileSyncError = null;
        this.nextWriteFileSyncError = null;
    }

    mkdirSync = (): void => {
        // no-op for in-memory: directories are implicit in the path keys
    };

    readFileSync = (filePath: string, encoding?: BufferEncoding): Buffer | string => {
        if (this.nextReadFileSyncError) {
            const err = this.nextReadFileSyncError;
            this.nextReadFileSyncError = null;
            throw err;
        }
        const file = this.files.get(filePath);
        if (!file) {
            throw enoent('open', filePath);
        }
        return encoding ? file.toString(encoding) : file;
    };

    writeFileSync = (filePath: string, content: string | Buffer): void => {
        if (this.nextWriteFileSyncError) {
            const err = this.nextWriteFileSyncError;
            this.nextWriteFileSyncError = null;
            throw err;
        }
        const buf = typeof content === 'string' ? Buffer.from(content) : content;
        this.files.set(filePath, buf);
    };
}
