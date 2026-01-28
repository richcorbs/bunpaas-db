export function parseExpand(expand) {
  if (!expand) return [];
  return expand.split(',').map(e => parseExpandOp(e.trim()));
}

function parseExpandOp(expr) {
  // Handle nested: "children:columns.children:cards"
  const dotIndex = expr.indexOf('.');
  if (dotIndex !== -1) {
    const first = expr.slice(0, dotIndex);
    const rest = expr.slice(dotIndex + 1);
    const op = parseExpandOp(first);
    op.nested = [parseExpandOp(rest)];
    return op;
  }

  // Handle children:collection
  if (expr.startsWith('children:')) {
    return { type: 'children', collection: expr.split(':')[1] };
  }

  // Handle parent, owner
  return { type: expr };
}
