---
title: Partners table
toc: false
---

# All Bath partners — sortable, filterable

Every row is a partner institution that has co-authored at least one publication with Bath, 2020 – mid-2026 (2026 partial). Sort any column. Use the filters at the top to narrow.

```js
import {DuckDBClient} from "npm:@observablehq/duckdb";
import {rows} from "./components/duck.js";

const db = await DuckDBClient.of({
  agg: FileAttachment("data/bath_collaborators.parquet")
});
const all = rows(await db.query(`SELECT * FROM agg ORDER BY focal_rank_of_partner`));

const allFors = [...new Set(all.map(d => d.dominant_for).filter(Boolean))].sort();
const allCountries = [...new Set(all.map(d => d.partner_country).filter(Boolean))].sort();
const allTypes = [...new Set(all.map(d => {
  if (!d.partner_type) return null;
  const arr = Array.isArray(d.partner_type) ? d.partner_type : [...d.partner_type];
  return arr[0] ?? null;
}).filter(Boolean))].sort();
```

```js
const minCopubs = view(Inputs.range([1, 200], {value: 5, step: 1, label: "Min co-publications"}));
```

```js
const countryFilter = view(Inputs.select(
  ["All", "UK only (GB)", "International only (non-GB)"],
  {value: "All", label: "Country group"}
));
```

```js
const country = view(Inputs.select(
  ["(any)", ...allCountries],
  {value: "(any)", label: "Specific country"}
));
```

```js
const forFilter = view(Inputs.select(
  ["(any)", ...allFors],
  {value: "(any)", label: "Dominant field of research"}
));
```

```js
const typeFilter = view(Inputs.select(
  ["(any)", ...allTypes],
  {value: "(any)", label: "Organisation type"}
));
```

```js
const filtered = all
  .map(d => {
    const arr = !d.partner_type ? [] : (Array.isArray(d.partner_type) ? d.partner_type : [...d.partner_type]);
    return {...d, primary_type: arr[0] ?? null};
  })
  .filter(d => {
    if (d.n_copublications < minCopubs) return false;
    if (countryFilter === "UK only (GB)" && d.partner_country !== "GB") return false;
    if (countryFilter === "International only (non-GB)" && d.partner_country === "GB") return false;
    if (country !== "(any)" && d.partner_country !== country) return false;
    if (forFilter !== "(any)" && d.dominant_for !== forFilter) return false;
    if (typeFilter !== "(any)" && d.primary_type !== typeFilter) return false;
    return true;
  });
```

<div class="filter-summary">Showing <b>${filtered.length.toLocaleString()}</b> of ${all.length.toLocaleString()} partners.</div>

```js
display(Inputs.table(filtered, {
  columns: [
    "focal_rank_of_partner", "partner_rank_of_focal", "rank_asymmetry",
    "partner_name", "partner_country", "primary_type",
    "n_copublications", "n_fractional",
    "dominant_for", "dominant_for_share",
    "partner_n_collaborators"
  ],
  header: {
    focal_rank_of_partner: "Bath's rank of partner",
    partner_rank_of_focal: "Partner's rank of Bath",
    rank_asymmetry: "Asymmetry",
    partner_name: "Partner",
    partner_country: "Country",
    primary_type: "Type",
    n_copublications: "Co-pubs",
    n_fractional: "Fractional",
    dominant_for: "Dominant FoR",
    dominant_for_share: "FoR share",
    partner_n_collaborators: "Partner's # collaborators"
  },
  format: {
    n_fractional: x => x == null ? "—" : x.toFixed(1),
    dominant_for_share: x => x == null ? "—" : `${(x * 100).toFixed(1)}%`
  },
  rows: 50,
  width: {partner_name: 320, dominant_for: 180}
}));
```

<style>
.filter-summary { font-size: 0.9rem; color: var(--theme-foreground-muted); margin: 0.5rem 0; }
</style>
