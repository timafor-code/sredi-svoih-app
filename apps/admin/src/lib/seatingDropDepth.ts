export type SeatingDropDepth = {
  depth: number;
  isOver: boolean;
};

export function enter(depth: number): SeatingDropDepth {
  const nextDepth = Math.max(0, depth) + 1;
  return { depth: nextDepth, isOver: true };
}

export function leave(depth: number): SeatingDropDepth {
  const nextDepth = Math.max(0, depth - 1);
  return { depth: nextDepth, isOver: nextDepth > 0 };
}

export function reset(): SeatingDropDepth {
  return { depth: 0, isOver: false };
}
