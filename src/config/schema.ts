import { z } from "zod";

export const modelRefSchema = z.object({
  provider: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
});

export const contextConfigSchema = z.object({
  maxTokens: z.int().positive().default(32_000),
  compactThreshold: z.number().positive().max(1).default(0.8),
  toolResultMaxChars: z.int().positive().default(12_000),
});

export const stdioMcpServerSchema = z.object({
  command: z.string().trim().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
});

export const tinyCodeConfigSchema = z.object({
  model: modelRefSchema.default({}),
  maxOutputTokens: z.int().positive().default(4_096),
  permissionMode: z.enum(["ask", "auto"]).default("ask"),
  context: contextConfigSchema.default({
    maxTokens: 32_000,
    compactThreshold: 0.8,
    toolResultMaxChars: 12_000,
  }),
  mcpServers: z.record(z.string(), stdioMcpServerSchema).default({}),
});

export type TinyCodeConfig = z.infer<typeof tinyCodeConfigSchema>;
