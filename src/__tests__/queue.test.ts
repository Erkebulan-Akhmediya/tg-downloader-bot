import { TaskQueue } from '../queue';

const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
};

const tick = () => new Promise((r) => setImmediate(r));

describe('TaskQueue', () => {
    test('runs at most `concurrency` tasks at once', async () => {
        const queue = new TaskQueue(2, 10);
        const gates = [deferred(), deferred(), deferred()];
        const started: number[] = [];
        gates.forEach((gate, i) =>
            queue.push(async () => {
                started.push(i);
                await gate.promise;
            }),
        );

        await tick();
        expect(started).toEqual([0, 1]);
        expect(queue.active).toBe(2);
        expect(queue.size).toBe(1);

        gates[0].resolve();
        await tick();
        await tick();
        expect(started).toEqual([0, 1, 2]);
        gates[1].resolve();
        gates[2].resolve();
        await tick();
        await tick();
        expect(queue.active).toBe(0);
    });

    test('drops tasks when full and survives failing tasks', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const queue = new TaskQueue(1, 1);
        const gate = deferred();
        expect(queue.push(() => gate.promise)).toBe(true); // running
        expect(queue.push(() => Promise.reject(new Error('boom')))).toBe(true); // waiting
        expect(queue.push(async () => undefined)).toBe(false); // dropped
        gate.resolve();
        await tick();
        await tick();
        await tick();
        expect(queue.active).toBe(0);
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });
});
