---
title: By organisation type
toc: false
---

# Collaborations by organisation type

GRID classifies each institution by type: Education (universities), Healthcare (hospitals, NHS trusts, research hospitals), Facility (national labs, observatories, light sources), Government (agencies, public sector), Company, Nonprofit, Other, Archive.

```js
import {DuckDBClient} from "npm:@observablehq/duckdb";
import {rows} from "./components/duck.js";

const db = await DuckDBClient.of({
  agg: FileAttachment("data/bath_collaborators.parquet")
});
const all = rows(await db.query(`SELECT * FROM agg`)).map(d => {
  const arr = !d.partner_type ? [] : (Array.isArray(d.partner_type) ? d.partner_type : [...d.partner_type]);
  return {...d, primary_type: arr[0] ?? "Unknown"};
});
```

```js
const byType = (() => {
  const m = new Map();
  for (const d of all) {
    const k = d.primary_type;
    const cur = m.get(k) ?? {primary_type: k, n_partners: 0, n_copubs: 0};
    cur.n_partners += 1;
    cur.n_copubs += d.n_copublications;
    m.set(k, cur);
  }
  const total = all.reduce((a, d) => a + d.n_copublications, 0);
  const arr = [...m.values()].sort((a, b) => b.n_copubs - a.n_copubs);
  for (const r of arr) r.share_of_total = r.n_copubs / total;
  return arr;
})();
```

## Type totals

```js
display(Inputs.table(byType, {
  columns: ["primary_type", "n_partners", "n_copubs", "share_of_total"],
  header: {
    primary_type: "Type",
    n_partners: "Partners",
    n_copubs: "Co-pubs",
    share_of_total: "Share of Bath co-pubs"
  },
  format: {
    share_of_total: x => x == null ? "—" : `${(x * 100).toFixed(1)}%`
  },
  rows: 12
}));
```

## Top partners within a type

```js
const ptype = view(Inputs.select(
  byType.map(d => d.primary_type),
  {value: "Healthcare", label: "Organisation type", sort: true, unique: true}
));
```

```js
const sub = all.filter(d => d.primary_type === ptype).sort((a, b) => b.n_copublications - a.n_copublications).slice(0, 25);
display(Inputs.table(sub, {
  columns: [
    "partner_name", "partner_country", "n_copublications",
    "dominant_for", "focal_rank_of_partner", "partner_rank_of_focal", "rank_asymmetry"
  ],
  header: {
    partner_name: "Partner",
    partner_country: "Country",
    n_copublications: "Co-pubs",
    dominant_for: "Dominant FoR",
    focal_rank_of_partner: "Bath's rank",
    partner_rank_of_focal: "Their rank of Bath",
    rank_asymmetry: "Asymmetry"
  },
  rows: 25,
  width: {partner_name: 320, dominant_for: 200}
}));
```

For the **Healthcare** and **Company** types, look for highly *negative* asymmetry — those are the relationships where Bath is the dominant academic partner.
