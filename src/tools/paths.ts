import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

function isInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return (
    relation === "" ||
    (relation !== ".." &&
      !relation.startsWith(`..${sep}`) &&
      !isAbsolute(relation))
  );
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export function resolveWorkspacePath(projectRoot: string, raw = "."): string {
  const root = resolve(projectRoot);
  const candidate = resolve(root, raw);

  if (!isInside(root, candidate)) {
    throw new Error(`Path escapes workspace: ${raw}`);
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(root);
  } catch {
    throw new Error(`Workspace root does not exist: ${root}`);
  }

  const relation = relative(root, candidate);
  let current = root;
  for (const component of relation === "" ? [] : relation.split(sep)) {
    current = join(current, component);

    let symbolicLink: boolean;
    try {
      symbolicLink = lstatSync(current).isSymbolicLink();
    } catch (error) {
      if (isMissing(error)) {
        break;
      }
      throw error;
    }

    let canonicalCurrent: string;
    try {
      canonicalCurrent = realpathSync(current);
    } catch (error) {
      if (symbolicLink && isMissing(error)) {
        throw new Error(`Broken symbolic link in workspace path: ${current}`, {
          cause: error,
        });
      }
      throw error;
    }

    if (!isInside(canonicalRoot, canonicalCurrent)) {
      throw new Error(`Path resolves outside workspace: ${raw}`);
    }
  }

  return candidate;
}
