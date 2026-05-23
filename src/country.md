---
title: By country
toc: false
---

# Bath collaborations by country

For each country, top partners by Bath co-publication volume + top reciprocals — partners IN that country where Bath ranks highest in their list. The reciprocal view is filtered to partners with at least the chosen number of distinct collaborators so we exclude one-off industry hits.

```js
import {DuckDBClient} from "npm:@observablehq/duckdb";
import {rows} from "./components/duck.js";

const db = await DuckDBClient.of({
  agg: FileAttachment("data/bath_collaborators.parquet")
});
const all = rows(await db.query(`SELECT * FROM agg WHERE partner_country IS NOT NULL`));
```

```js
// totals per country
const byCountry = (() => {
  const m = new Map();
  for (const d of all) {
    if (!d.partner_country) continue;
    const k = d.partner_country;
    const cur = m.get(k) ?? {country: k, n_partners: 0, n_copubs: 0, n_intl_partners: 0};
    cur.n_partners += 1;
    cur.n_copubs += d.n_copublications;
    m.set(k, cur);
  }
  // top partner per country
  for (const [k, v] of m) {
    const top = all.filter(d => d.partner_country === k).sort((a, b) => b.n_copublications - a.n_copublications)[0];
    v.top_partner = top?.partner_name;
    v.top_partner_copubs = top?.n_copublications;
    v.top_partner_reciprocal = top?.partner_rank_of_focal;
  }
  return [...m.values()].sort((a, b) => b.n_copubs - a.n_copubs);
})();
```

## Country totals

```js
display(Inputs.table(byCountry, {
  columns: ["country", "n_partners", "n_copubs", "top_partner", "top_partner_copubs", "top_partner_reciprocal"],
  header: {
    country: "Country",
    n_partners: "Partners",
    n_copubs: "Co-pubs",
    top_partner: "Top partner",
    top_partner_copubs: "Co-pubs (top)",
    top_partner_reciprocal: "Partner's rank of Bath"
  },
  rows: 30,
  width: {top_partner: 300}
}));
```

## Drilldown into a single country

```js
const country = view(Inputs.select(
  byCountry.map(d => d.country),
  {value: "US", label: "Country", sort: true, unique: true}
));
```

```js
const minCollabs = view(Inputs.range([10, 500], {value: 50, step: 10, label: "Min partner size (for the reciprocal view)"}));
```

```js
const sub = all.filter(d => d.partner_country === country);
const byVolume = sub.slice().sort((a, b) => b.n_copublications - a.n_copublications).slice(0, 10);
const byRecip = sub
  .filter(d => d.partner_n_collaborators >= minCollabs)
  .slice()
  .sort((a, b) => a.partner_rank_of_focal - b.partner_rank_of_focal)
  .slice(0, 10);
```

### Top 10 ${country} partners by Bath co-pub volume

```js
display(Inputs.table(byVolume, {
  columns: [
    "partner_name", "n_copublications", "dominant_for",
    "focal_rank_of_partner", "partner_rank_of_focal", "rank_asymmetry",
    "partner_n_collaborators"
  ],
  header: {
    partner_name: "Partner",
    n_copublications: "Co-pubs",
    dominant_for: "Dominant FoR",
    focal_rank_of_partner: "Bath's rank",
    partner_rank_of_focal: "Their rank of Bath",
    rank_asymmetry: "Asymmetry",
    partner_n_collaborators: "Partner's # collaborators"
  },
  rows: 10,
  width: {partner_name: 280, dominant_for: 180}
}));
```

### Top 10 ${country} reciprocals — where Bath ranks highest in *their* list

Partners with ≥ ${minCollabs} distinct collaborators only.

```js
if (byRecip.length === 0) {
  display(html`<div class="filter-summary">No partners in <b>${country}</b> meet the size threshold.</div>`);
} else {
  display(Inputs.table(byRecip, {
    columns: [
      "partner_rank_of_focal", "partner_name",
      "n_copublications", "dominant_for",
      "focal_rank_of_partner", "rank_asymmetry",
      "partner_n_collaborators"
    ],
    header: {
      partner_rank_of_focal: "Their rank of Bath",
      partner_name: "Partner",
      n_copublications: "Co-pubs",
      dominant_for: "Dominant FoR",
      focal_rank_of_partner: "Bath's rank",
      rank_asymmetry: "Asymmetry",
      partner_n_collaborators: "Partner's # collaborators"
    },
    rows: 10,
    width: {partner_name: 280, dominant_for: 180}
  }));
}
```

<style>
.filter-summary { font-size: 0.9rem; color: var(--theme-foreground-muted); margin: 0.5rem 0; }
</style>
