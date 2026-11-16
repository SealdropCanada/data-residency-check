import { execFile } from 'node:child_process';

/** Runs a cloud CLI (aws, az, gcloud) and parses its JSON, or null when it fails. Injected in tests. */
export type Run = (cmd: string, args: string[]) => Promise<unknown>;

export const runCli: Run = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 256 * 1024 * 1024, timeout: 120_000 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : null);
      } catch {
        resolve(null);
      }
    });
  });

/** Runs tasks with at most `n` at a time (a CLI call per region and service adds up). */
export async function limit<T>(n: number, tasks: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        out[i] = await tasks[i]!();
      }
    }),
  );
  return out;
}
