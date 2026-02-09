export function flattenItem(item) {
  let { data, _expanded, ...rest } = item;
  if (typeof data === "string") data = JSON.parse(data);
  const result = { ...rest, ...data };

  if (_expanded) {
    result._expanded = {};
    for (const [key, value] of Object.entries(_expanded)) {
      if (Array.isArray(value)) {
        result._expanded[key] = value.map(flattenItem);
      } else if (value) {
        result._expanded[key] = flattenItem(value);
      }
    }
  }

  return result;
}
