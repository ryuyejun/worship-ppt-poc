/** Preserve original fields and stable MySQL IDs, including unknown permission states. */
export function mapRows(rows) {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  const seen = new Set();
  return rows.map((row) => {
    const id = String(row.id ?? '');
    if (!/^[1-9]\d*$/.test(id) || seen.has(id)) throw new Error('invalid or duplicate id');
    seen.add(id);
    return { id, data: { ...row, id: Number(id) } };
  });
}
