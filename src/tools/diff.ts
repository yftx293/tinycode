export interface LineChangeStats {
  additions: number;
  deletions: number;
}

interface DiffOperation {
  type: "equal" | "add" | "delete";
  line: string;
}

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function valueAt(frontier: ReadonlyMap<number, number>, diagonal: number): number {
  return frontier.get(diagonal) ?? 0;
}

function backtrack(
  previous: readonly string[],
  next: readonly string[],
  trace: readonly ReadonlyMap<number, number>[],
  distance: number,
): DiffOperation[] {
  const reversed: DiffOperation[] = [];
  let previousIndex = previous.length;
  let nextIndex = next.length;

  for (let depth = distance; depth > 0; depth -= 1) {
    const frontier = trace[depth];
    if (frontier === undefined) {
      throw new Error("Unable to construct line diff");
    }
    const diagonal = previousIndex - nextIndex;
    const previousDiagonal =
      diagonal === -depth ||
      (diagonal !== depth &&
        valueAt(frontier, diagonal - 1) <
          valueAt(frontier, diagonal + 1))
        ? diagonal + 1
        : diagonal - 1;
    const priorPreviousIndex = valueAt(frontier, previousDiagonal);
    const priorNextIndex = priorPreviousIndex - previousDiagonal;

    while (
      previousIndex > priorPreviousIndex &&
      nextIndex > priorNextIndex
    ) {
      previousIndex -= 1;
      nextIndex -= 1;
      reversed.push({
        type: "equal",
        line: previous[previousIndex] ?? "",
      });
    }

    if (previousIndex === priorPreviousIndex) {
      nextIndex -= 1;
      reversed.push({ type: "add", line: next[nextIndex] ?? "" });
    } else {
      previousIndex -= 1;
      reversed.push({
        type: "delete",
        line: previous[previousIndex] ?? "",
      });
    }
  }

  while (previousIndex > 0 && nextIndex > 0) {
    previousIndex -= 1;
    nextIndex -= 1;
    reversed.push({ type: "equal", line: previous[previousIndex] ?? "" });
  }
  while (previousIndex > 0) {
    previousIndex -= 1;
    reversed.push({
      type: "delete",
      line: previous[previousIndex] ?? "",
    });
  }
  while (nextIndex > 0) {
    nextIndex -= 1;
    reversed.push({ type: "add", line: next[nextIndex] ?? "" });
  }

  return reversed.reverse();
}

function lineDiff(previousText: string, nextText: string): DiffOperation[] {
  const previous = splitLines(previousText);
  const next = splitLines(nextText);
  const maximumDistance = previous.length + next.length;
  const frontier = new Map<number, number>([[1, 0]]);
  const trace: ReadonlyMap<number, number>[] = [];

  for (let distance = 0; distance <= maximumDistance; distance += 1) {
    trace.push(new Map(frontier));
    for (
      let diagonal = -distance;
      diagonal <= distance;
      diagonal += 2
    ) {
      let previousIndex =
        diagonal === -distance ||
        (diagonal !== distance &&
          valueAt(frontier, diagonal - 1) <
            valueAt(frontier, diagonal + 1))
          ? valueAt(frontier, diagonal + 1)
          : valueAt(frontier, diagonal - 1) + 1;
      let nextIndex = previousIndex - diagonal;

      while (
        previousIndex < previous.length &&
        nextIndex < next.length &&
        previous[previousIndex] === next[nextIndex]
      ) {
        previousIndex += 1;
        nextIndex += 1;
      }
      frontier.set(diagonal, previousIndex);

      if (previousIndex >= previous.length && nextIndex >= next.length) {
        return backtrack(previous, next, trace, distance);
      }
    }
  }

  throw new Error("Unable to calculate line diff");
}

export function calculateLineChanges(
  previous: string,
  next: string,
): LineChangeStats {
  const operations = lineDiff(previous, next);
  return {
    additions: operations.filter((operation) => operation.type === "add").length,
    deletions: operations.filter((operation) => operation.type === "delete")
      .length,
  };
}

function hunkRanges(operations: readonly DiffOperation[]): [number, number][] {
  const changes = operations.flatMap((operation, index) =>
    operation.type === "equal" ? [] : [index],
  );
  const first = changes[0];
  if (first === undefined) {
    return [];
  }

  const ranges: [number, number][] = [];
  let start = Math.max(0, first - 3);
  let end = Math.min(operations.length, first + 4);
  for (const change of changes.slice(1)) {
    const nextStart = Math.max(0, change - 3);
    const nextEnd = Math.min(operations.length, change + 4);
    if (nextStart <= end) {
      end = Math.max(end, nextEnd);
    } else {
      ranges.push([start, end]);
      start = nextStart;
      end = nextEnd;
    }
  }
  ranges.push([start, end]);
  return ranges;
}

function lineNumberBefore(
  operations: readonly DiffOperation[],
  end: number,
  side: "previous" | "next",
): number {
  let lineNumber = 1;
  for (const operation of operations.slice(0, end)) {
    if (
      operation.type === "equal" ||
      (side === "previous" && operation.type === "delete") ||
      (side === "next" && operation.type === "add")
    ) {
      lineNumber += 1;
    }
  }
  return lineNumber;
}

export function createUnifiedDiff(
  displayPath: string,
  previous: string,
  next: string,
): string {
  const operations = lineDiff(previous, next);
  const lines = [`--- a/${displayPath}`, `+++ b/${displayPath}`];

  for (const [start, end] of hunkRanges(operations)) {
    const hunk = operations.slice(start, end);
    const previousStart = lineNumberBefore(operations, start, "previous");
    const nextStart = lineNumberBefore(operations, start, "next");
    const previousCount = hunk.filter(
      (operation) => operation.type !== "add",
    ).length;
    const nextCount = hunk.filter(
      (operation) => operation.type !== "delete",
    ).length;
    lines.push(
      `@@ -${String(previousStart)},${String(previousCount)} +${String(nextStart)},${String(nextCount)} @@`,
    );
    for (const operation of hunk) {
      const prefix =
        operation.type === "equal"
          ? " "
          : operation.type === "add"
            ? "+"
            : "-";
      lines.push(`${prefix}${operation.line}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
