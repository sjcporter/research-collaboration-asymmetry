// Convert a DuckDB-WASM / Apache Arrow Table to a plain array of JS objects.
// Same helper as the gender repo — see that project's README for the back-story.

export function rows(table) {
  const fields = table.schema.fields.map(f => f.name);
  const cols = Object.fromEntries(fields.map(f => [f, table.getChild(f)]));
  const out = new Array(table.numRows);
  for (let i = 0; i < table.numRows; i++) {
    const row = {};
    for (const f of fields) {
      let v = cols[f].get(i);
      // Arrow Int64 surfaces as JS BigInt; coerce to Number so arithmetic, log scales,
      // and .toFixed() / .toLocaleString() all work without TypeErrors.
      if (typeof v === "bigint") v = Number(v);
      row[f] = v;
    }
    out[i] = row;
  }
  return out;
}

// Tableau-10 inspired palette for first-level fields of research.
// Top-coverage FoRs across Bath's partner profile get explicit colours;
// the catch-all "Other" is grey.
export const FOR_COLORS = {
  "Biomedical and Clinical Sciences":           "#1f77b4",
  "Health Sciences":                            "#ff7f0e",
  "Engineering":                                "#2ca02c",
  "Physical Sciences":                          "#d62728",
  "Chemical Sciences":                          "#9467bd",
  "Biological Sciences":                        "#8c564b",
  "Psychology":                                 "#e377c2",
  "Commerce, Management, Tourism and Services": "#bcbd22",
  "Earth Sciences":                             "#17becf",
  "Information and Computing Sciences":         "#7f7f7f",
  "Mathematical Sciences":                      "#aec7e8",
  "Education":                                  "#ffbb78",
  "Other":                                      "#cccccc"
};
