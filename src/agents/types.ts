export type WorkerStatus = "running" | "completed" | "aborted" | "error";

export interface WorkerReport {
  id: string;
  name: string;
  task: string;
  status: WorkerStatus;
  report: string;
  durationMs: number;
}
