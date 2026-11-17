type Task = () => Promise<void>;

/**
 * Minimal in-memory job queue with a concurrency limit.
 * Keeps memory bounded: only `concurrency` downloads run at once and at most
 * `maxSize` jobs wait. Nothing is persisted - pending jobs are lost on restart
 * by design (stale messages are skipped anyway).
 */
export class TaskQueue {
    private readonly pending: Task[] = [];
    private running = 0;

    constructor(
        private readonly concurrency: number,
        private readonly maxSize: number,
    ) {}

    get size(): number {
        return this.pending.length;
    }

    get active(): number {
        return this.running;
    }

    /** Returns false when the queue is full and the task was dropped. */
    push(task: Task): boolean {
        if (this.pending.length >= this.maxSize) return false;
        this.pending.push(task);
        this.next();
        return true;
    }

    private next(): void {
        while (this.running < this.concurrency && this.pending.length > 0) {
            const task = this.pending.shift() as Task;
            this.running++;
            task()
                .catch((err) => console.error('Queued task failed:', err))
                .finally(() => {
                    this.running--;
                    this.next();
                });
        }
    }
}
