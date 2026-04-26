/**
 * In-memory drop-in for the subset of node:fs that jostore touches:
 * `openSync`, `readSync`, `writeSync`, `fsyncSync`, `closeSync`,
 * `statSync`, `mkdirSync`, `readFileSync`, `writeFileSync`.
 *
 * Used by acceptance tests so they never touch the real filesystem
 * (per the project's "tests must use mocks" rule). Behaviour matches
 * Node's sync fs closely enough for jostore's block-file layout:
 * - Writing past current EOF zero-pads up to the write position.
 * - Reading past EOF returns 0 bytes.
 * - `r+` on a missing file throws ENOENT; `w+` creates it empty.
 */

interface OpenFile {
    path: string;
}

function enoent(action: string, path: string): NodeJS.ErrnoException {
    const err = new Error(`ENOENT: no such file or directory, ${action} '${path}'`) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    return err;
}

export class MockFs {
    files = new Map<string, Buffer>();
    private fds = new Map<number, OpenFile>();
    private nextFd = 3;

    /**
     * Test hook: if set, the next call to `openSync` consumes this error and
     * throws it instead of running normally. Lets tests cover the
     * non-ENOENT branch in `_openDataFile` without monkey-patching the mock,
     * which the ESM module namespace caches around.
     */
    nextOpenError: NodeJS.ErrnoException | null = null;

    /**
     * Test hook: if set, the next call to `fsyncSync` throws this error.
     * Used to exercise `_runExitCleanup`'s catch block.
     */
    nextFsyncError: Error | null = null;

    /** Wipe file contents; keep `nextFd` monotonic so old fds never collide with new ones. */
    reset(): void {
        this.files.clear();
        this.fds.clear();
        this.nextOpenError = null;
        this.nextFsyncError = null;
    }

    openSync = (filePath: string, flags: string): number => {
        if (this.nextOpenError) {
            const err = this.nextOpenError;
            this.nextOpenError = null;
            throw err;
        }
        const exists = this.files.has(filePath);
        if (flags === 'r+' && !exists) {
            throw enoent('open', filePath);
        }
        if (flags.startsWith('w') || (flags === 'r+' && !exists)) {
            this.files.set(filePath, Buffer.alloc(0));
        }
        const fd = this.nextFd++;
        this.fds.set(fd, { path: filePath });
        return fd;
    };

    readSync = (
        fd: number,
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
    ): number => {
        const open = this.fds.get(fd);
        if (!open) {
            throw new Error(`Invalid fd ${fd}`);
        }
        const file = this.files.get(open.path);
        if (!file) {
            throw new Error(`File ${open.path} disappeared`);
        }
        const bytesAvailable = Math.max(0, file.length - position);
        const bytesToRead = Math.min(length, bytesAvailable);
        if (bytesToRead > 0) {
            file.copy(buffer, offset, position, position + bytesToRead);
        }
        return bytesToRead;
    };

    writeSync = (fd: number, data: string | Buffer, position?: number): number => {
        const open = this.fds.get(fd);
        if (!open) {
            throw new Error(`Invalid fd ${fd}`);
        }
        const buf = typeof data === 'string' ? Buffer.from(data) : data;
        const existing = this.files.get(open.path) ?? Buffer.alloc(0);
        const writePos = position ?? existing.length;
        const newSize = Math.max(existing.length, writePos + buf.length);
        const grown = Buffer.alloc(newSize); // alloc zero-fills
        existing.copy(grown);
        buf.copy(grown, writePos);
        this.files.set(open.path, grown);
        return buf.length;
    };

    fsyncSync = (): void => {
        if (this.nextFsyncError) {
            const err = this.nextFsyncError;
            this.nextFsyncError = null;
            throw err;
        }
        // otherwise no-op for in-memory
    };

    closeSync = (fd: number): void => {
        this.fds.delete(fd);
    };

    statSync = (filePath: string): { size: number } => {
        const file = this.files.get(filePath);
        if (!file) {
            throw enoent('stat', filePath);
        }
        return { size: file.length };
    };

    mkdirSync = (): void => {
        // no-op for in-memory: directories are implicit in the path keys
    };

    readFileSync = (filePath: string): Buffer => {
        const file = this.files.get(filePath);
        if (!file) {
            throw enoent('open', filePath);
        }
        return file;
    };

    writeFileSync = (filePath: string, content: string | Buffer): void => {
        const buf = typeof content === 'string' ? Buffer.from(content) : content;
        this.files.set(filePath, buf);
    };
}
