---
title: By field of research
toc: false
---

# Collaborations by dominant field of research

Each Bath–partner pair is tagged with the partner's modal first-level Field of Research (FoR) over the co-authored publications, 2020–2024. Note: this is the FoR that *characterises the partnership*, not the partner's full research portfolio.

```js
import {DuckDBClient} from "npm:@observablehq/duckdb";
import {rows} from "./components/duck.js";

const db = await DuckDBClient.of({
  agg: FileAttachment("data/bath_collaborators.parquet")
});
const all = rows(await db.query(`SELECT * FROM agg WHERE dominant_for IS NOT NULL`));
```

```js
const byFor = (() => {
  const m = new Map();
  for (const d of all) {
    const k = d.dominant_for;
    const cur = m.get(k) ?? {
      dominant_for: k,
      n_partners: 0,
      n_copubs: 0,
      n_uk_partners: 0,
      n_intl_partners: 0
    };
    cur.n_partners += 1;
    cur.n_copubs += d.n_copublications;
    if (d.partner_country === "GB") cur.n_uk_partners += 1;
    else if (d.partner_country) cur.n_intl_partners += 1;
    m.set(k, cur);
  }
  const total = all.reduce((a, d) => a + d.n_copublications, 0);
  const arr = [...m.values()].sort((a, b) => b.n_copubs - a.n_copubs);
  for (const r of arr) {
    r.intl_share = r.n_intl_partners / (r.n_intl_partners + r.n_uk_partners);
    r.share_of_total = r.n_copubs / total;
  }
  return arr;
})();
```

## FoR totals

```js
display(Inputs.table(byFor, {
  columns: ["dominant_for", "n_partners", "n_copubs", "share_of_total", "n_uk_partners", "n_intl_partners", "intl_share"],
  header: {
    dominant_for: "Field of research",
    n_partners: "Partners",
    n_copubs: "Co-pubs",
    share_of_total: "Share of Bath co-pubs",
    n_uk_partners: "UK partners",
    n_intl_partners: "Intl partners",
    intl_share: "Intl share"
  },
  format: {
    share_of_total: x => x == null ? "—" : `${(x * 100).toFixed(1)}%`,
    intl_share: x => x == null ? "—" : `${(x * 100).toFixed(0)}%`
  },
  rows: 25,
  width: {dominant_for: 280}
}));
```

## Top partners within a field

```js
const field = view(Inputs.select(
  byFor.map(d => d.dominant_for),
  {value: "Biomedical and Clinical Sciences", label: "Field of research", sort: true, unique: true}
));
```

```js
const sub = all.filter(d => d.dominant_for === field).sort((a, b) => b.n_copublications - a.n_copublications).slice(0, 25);
display(Inputs.table(sub, {
  columns: [
    "partner_name", "partner_country", "n_copublications",
    "dominant_for_share", "focal_rank_of_partner", "partner_rank_of_focal", "rank_asymmetry"
  ],
  header: {
    partner_name: "Partner",
    partner_country: "Country",
    n_copublications: "Co-pubs",
    dominant_for_share: "FoR share (of pair's pubs)",
    focal_rank_of_partner: "Bath's rank",
    partner_rank_of_focal: "Their rank of Bath",
    rank_asymmetry: "Asymmetry"
  },
  format: {
    dominant_for_share: x => x == null ? "—" : `${(x * 100).toFixed(0)}%`
  },
  rows: 25,
  width: {partner_name: 320}
}));
```
