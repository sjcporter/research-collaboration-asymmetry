---
title: Overview
toc: false
---

# Research collaboration asymmetry

The University of Bath co-authored ~32,000 distinct publications with other research organisations between 2020 and 2024. For each of Bath's **5,461 partner institutions** we know two ranks: where the partner sits in *Bath's* collaboration ranking, and where Bath sits in the *partner's* ranking. The gap between the two is the **asymmetry** — it answers "for whom does this relationship matter more?".

```js
import {DuckDBClient} from "npm:@observablehq/duckdb";
import {rows, FOR_COLORS} from "./components/duck.js";

const db = await DuckDBClient.of({
  agg: FileAttachment("data/bath_collaborators.parquet")
});
```

```js
const all = rows(await db.query(`SELECT * FROM agg`));
const totalCopubs = all.reduce((a, d) => a + d.n_copublications, 0);
const totalUkCopubs = all.filter(d => d.partner_country === "GB").reduce((a, d) => a + d.n_copublications, 0);
const totalIntlCopubs = totalCopubs - totalUkCopubs;
const nCountries = new Set(all.map(d => d.partner_country).filter(Boolean)).size;
const topFor = (() => {
  const byFor = new Map();
  for (const d of all) {
    if (!d.dominant_for) continue;
    byFor.set(d.dominant_for, (byFor.get(d.dominant_for) ?? 0) + d.n_copublications);
  }
  return [...byFor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
})();
```

<div class="grid grid-cols-4">
  <div class="card">
    <h2>Partners</h2>
    <span class="big">${all.length.toLocaleString()}</span>
    <span>distinct institutions</span>
  </div>
  <div class="card">
    <h2>Countries</h2>
    <span class="big">${nCountries}</span>
    <span>represented</span>
  </div>
  <div class="card">
    <h2>International share</h2>
    <span class="big">${((totalIntlCopubs / totalCopubs) * 100).toFixed(1)}%</span>
    <span>of total co-pub volume</span>
  </div>
  <div class="card">
    <h2>Top fields of research</h2>
    <div class="for-list">
      ${topFor.map(([f, n]) => `<div><b>${f}</b> &mdash; ${((n / totalCopubs) * 100).toFixed(1)}%</div>`).join("")}
    </div>
  </div>
</div>

## The asymmetry scatter

Each dot is a Bath partner. The x-axis is Bath's rank of the partner (1 = top); the y-axis is the partner's rank of Bath. Both are log-scaled so the **diagonal `y = x` line is the symmetric relationship** — partners that fall on it value Bath as much as Bath values them.

- **Above the diagonal**: partner ranks Bath far lower than Bath ranks them. Bath is *peripheral* to the partner. Russell-Group / Ivy-League ties typically sit here.
- **Below the diagonal**: partner ranks Bath higher than Bath ranks them. Bath is the *anchor* — the partner depends on Bath more than Bath depends on it. Typically local hospitals, regional industry, and specialist research bodies.

Use the controls to filter and re-cut. Dot size = √(co-publications). Hover for partner detail.

```js
const allFors = [...new Set(all.map(d => d.dominant_for).filter(Boolean))].sort();
const allCountries = [...new Set(all.map(d => d.partner_country).filter(Boolean))].sort();
```

```js
const minCopubs = view(Inputs.range([1, 200], {value: 10, step: 1, label: "Min co-publications"}));
```

```js
const minCollabs = view(Inputs.range([0, 500], {value: 50, step: 10, label: "Min partner size (collaborators)"}));
```

```js
const countryFilter = view(Inputs.select(
  ["All", "UK only (GB)", "International only (non-GB)"],
  {value: "All", label: "Country"}
));
```

```js
const forFilter = view(Inputs.checkbox(allFors, {
  label: "Fields of research (unchecked = all)",
  sort: true
}));
```

```js
const filtered = all.filter(d => {
  if (d.n_copublications < minCopubs) return false;
  if (d.partner_n_collaborators < minCollabs) return false;
  if (countryFilter === "UK only (GB)" && d.partner_country !== "GB") return false;
  if (countryFilter === "International only (non-GB)" && d.partner_country === "GB") return false;
  if (forFilter && forFilter.length > 0 && !forFilter.includes(d.dominant_for)) return false;
  if (d.focal_rank_of_partner == null || d.partner_rank_of_focal == null) return false;
  return true;
});

// Top-12 most common FoRs in the filtered set get explicit colours; rest -> "Other"
const forCounts = new Map();
for (const d of filtered) forCounts.set(d.dominant_for, (forCounts.get(d.dominant_for) ?? 0) + 1);
const topFors = [...forCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(d => d[0]);
const colored = filtered.map(d => ({
  ...d,
  plot_for: topFors.includes(d.dominant_for) ? d.dominant_for : "Other"
}));
const colorDomain = [...topFors, "Other"];
const colorRange = colorDomain.map(f => FOR_COLORS[f] ?? "#999");
```

<div class="filter-summary">Showing <b>${filtered.length.toLocaleString()}</b> of ${all.length.toLocaleString()} partners.</div>

```js
const lo = 1;
const hi = Math.max(
  ...filtered.map(d => d.focal_rank_of_partner),
  ...filtered.map(d => d.partner_rank_of_focal),
  10
) * 1.05;

display(Plot.plot({
  width,
  height: 620,
  marginLeft: 60,
  marginBottom: 60,
  x: {
    type: "log", domain: [lo, hi], grid: true,
    label: "Bath's rank of partner  →  (lower = more important to Bath)"
  },
  y: {
    type: "log", domain: [lo, hi], grid: true,
    label: "↑ Partner's rank of Bath  (lower = Bath more important to them)"
  },
  color: {
    domain: colorDomain,
    range: colorRange,
    legend: true,
    label: "Dominant field of research"
  },
  r: {range: [3, 24]},
  marks: [
    Plot.link([{x1: lo, x2: hi, y1: lo, y2: hi}], {
      x1: "x1", x2: "x2", y1: "y1", y2: "y2",
      stroke: "black", strokeDasharray: "4 4", strokeOpacity: 0.5
    }),
    Plot.dot(colored, {
      x: "focal_rank_of_partner",
      y: "partner_rank_of_focal",
      r: "n_copublications",
      fill: "plot_for",
      fillOpacity: 0.65,
      stroke: "black",
      strokeOpacity: 0.3,
      tip: true,
      channels: {
        Partner: "partner_name",
        Country: "partner_country",
        "Bath's rank of partner": "focal_rank_of_partner",
        "Partner's rank of Bath": "partner_rank_of_focal",
        "Co-publications": d => d.n_copublications.toLocaleString(),
        "Dominant FoR": "dominant_for"
      }
    }),
    Plot.text(
      colored.slice().sort((a, b) => b.n_copublications - a.n_copublications).slice(0, 18),
      {
        x: "focal_rank_of_partner",
        y: "partner_rank_of_focal",
        text: d => d.partner_name.length > 32 ? d.partner_name.slice(0, 30) + "…" : d.partner_name,
        dx: 6, dy: -4, fontSize: 10, fill: "#222"
      }
    )
  ]
}));
```

<style>
.big { font-size: 2.0rem; font-weight: 600; display: block; margin: 0.2rem 0; }
.card { padding: 1rem; }
.card h2 { font-size: 0.85rem; text-transform: uppercase; color: var(--theme-foreground-muted); margin: 0 0 0.25rem 0; }
.for-list div { font-size: 0.85rem; margin-bottom: 0.2rem; }
.filter-summary { font-size: 0.9rem; color: var(--theme-foreground-muted); margin: 0.5rem 0; }
</style>
