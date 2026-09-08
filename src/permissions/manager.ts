import { assessPermission } from "./rules.js";

export type PromptOutcome = "once" | "always" | "deny";

export type Decision =
  | { action: "allow"; reason: string }
  | { action: "deny"; reason: string };

export interface PermissionPromptRequest {
  toolName: string;
  input: Readonly<Record<string, unknown>>;
  reason: string;
  family: string;
}

export type PromptFn = (
  request: PermissionPromptRequest,
) => Promise<PromptOutcome> | PromptOutcome;

export class PermissionManager {
  private prompt: PromptFn | undefined;
  private mode: "ask" | "auto" = "ask";
  private readonly alwaysAllowedFamilies = new Set<string>();

  setPrompt(prompt: PromptFn): void {
    this.prompt = prompt;
  }

  setMode(mode: "ask" | "auto"): void {
    this.mode = mode;
  }

  async check(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<Decision> {
    const assessment = assessPermission(toolName, input);
    if (assessment.action === "allow" || assessment.action === "deny") {
      return {
        action: assessment.action,
        reason: assessment.reason,
      };
    }
    if (this.alwaysAllowedFamilies.has(assessment.family)) {
      return {
        action: "allow",
        reason: `${assessment.reason}; command family approved for this process`,
      };
    }
    if (this.mode === "auto") {
      return {
        action: "allow",
        reason: `${assessment.reason}; auto mode approved this request`,
      };
    }
    if (this.prompt === undefined) {
      return {
        action: "deny",
        reason: `${assessment.reason}; no approval prompt is available`,
      };
    }

    const outcome = await this.prompt({
      toolName,
      input,
      reason: assessment.reason,
      family: assessment.family,
    });
    if (outcome === "always") {
      this.alwaysAllowedFamilies.add(assessment.family);
    }
    return outcome === "deny"
      ? { action: "deny", reason: `${assessment.reason}; approval denied` }
      : { action: "allow", reason: `${assessment.reason}; approved ${outcome}` };
  }
}
