export type ExecutionResult = {
  id: string;
  exitCode: number;
  output: string;
  truncated?: boolean;
};
export class ExecutionError extends Error {
  constructor(readonly kind: "input" | "timeout" | "infrastructure") {
    super(
      {
        input: "Invalid request.",
        timeout: "Execution timed out.",
        infrastructure: "Execution failed.",
      }[kind],
    );
    this.name = "ExecutionError";
  }
}
export interface ExecutionStore {
  prepare(id: string): Promise<void>;
  read(id: string): Promise<ExecutionResult>;
  remove(id: string): Promise<void>;
}
export interface JobClient {
  create(id: string, message: string, deadline?: number): Promise<void>;
  wait(id: string, deadline: number): Promise<void>;
  remove(id: string, deadline?: number): Promise<void>;
}
export interface ExecutionService {
  execute(message: string): Promise<ExecutionResult>;
}
