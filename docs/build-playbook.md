# Build Playbook

How to build a static, interactive analysis portal on top of Dimensions / BigQuery — the recipe used for [`research-collaboration-asymmetry`](https://github.com/sjcporter/research-collaboration-asymmetry) and [`uk-senior-researcher-gender`](https://github.com/sjcporter/uk-senior-researcher-gender). Both ship as Observable Framework sites with a single Parquet bundled inside, queried client-side via DuckDB-WASM. No backend.

Each section is a recipe; gotchas are called out inline.

---

## 1. Connecting to BigQuery

Two paths — both authenticate via **Google Cloud SDK Application Default Credentials (ADC)**, so once `gcloud auth login` is done, every other tool just works.

### One-time setup

```bash
# 1. Install the SDK if it's not already on $PATH
brew install --cask google-cloud-sdk

# 2. Sign in once — opens a browser, stores creds in ~/.config/gcloud/
gcloud auth login                              # CLI identity
gcloud auth application-default login          # ADC for Python / other libraries

# 3. Set the working / billing project — this is the project that queries
#    get *billed against*, not where the source data lives.
gcloud config set project ds-consultancy-gbq
```

**Gotcha — project vs dataset.** GCP project IDs are global; BigQuery dataset names live inside a project. The path is `project.dataset.table`. In our case:
- Project: `ds-consultancy-gbq` ← what `gcloud config set project` wants
- Dataset: `sjcporter_consultancy` ← lives inside that project
- Source data: `dimensions-ai.data_analytics.publications` ← a different project we have read access to

If you `gcloud config set project sjcporter_consultancy` you'll get *"is not a valid project ID"* — that string is a dataset, not a project. (Both Bath repos hit this once.)

### Daily use — `bq` CLI

```bash
# Schema introspection
bq show --format=prettyjson dimensions-ai:data_analytics.publications

# Dry-run before executing anything unfamiliar — returns scan-byte estimate
bq --project_id=ds-consultancy-gbq query --use_legacy_sql=false --dry_run \
   < queries/build_collab_pairs.sql

# Run a saved SQL file
bq --project_id=ds-consultancy-gbq query --use_legacy_sql=false \
   < queries/build_collab_pairs.sql

# Pretty-print a sample query
bq --project_id=ds-consultancy-gbq query --use_legacy_sql=false --format=pretty \
   "SELECT * FROM \`ds-consultancy-gbq.sjcporter_consultancy.collab_pairs\` LIMIT 5"
```

**Always dry-run unfamiliar queries.** BigQuery bills on bytes scanned (~$5/TB). Both Bath projects' total spend stayed under £0.20 because every unfamiliar query was dry-run first and re-scoped if too expensive.

### Daily use — Python

```python
from google.cloud import bigquery

# Project is the *billing* project; data can live anywhere.
client = bigquery.Client(project="ds-consultancy-gbq")

# Dry-run for cost
dry = client.query(sql, job_config=bigquery.QueryJobConfig(dry_run=True, use_query_cache=False))
print(f"will scan ~{dry.total_bytes_processed / 1e9:.2f} GB")

# Actually run, pull as pandas, save as parquet
df = client.query(sql).result().to_dataframe(create_bqstorage_client=False)
df.to_parquet("data/result.parquet", index=False)
```

The Python client picks up ADC automatically — same credentials as `gcloud` / `bq`. No service account file in the repo.

**Gotcha — quota project warning.** You'll see *"authenticated using end user credentials … without a quota project"*. Either ignore it (works fine for personal-scale work) or run `gcloud auth application-default set-quota-project ds-consultancy-gbq` to silence it.

### Working with Dimensions' nested schema

Dimensions tables nest aggressively. The patterns we used:

```sql
-- Flatten authors → grid_ids
FROM `dimensions-ai.data_analytics.publications` p,
     UNNEST(authors) AS a,
     UNNEST(a.grid_ids) AS grid_id

-- Filter on "does any author have GRID X" without flattening
WHERE EXISTS (
  SELECT 1 FROM UNNEST(p.authors) a, UNNEST(a.grid_ids) g
  WHERE g = 'grid.7340.0'
)

-- Reduce a publication to distinct affiliations + distinct FoRs in one CTE
-- (cheaper than separate UNNESTs further down)
SELECT
  p.id,
  ARRAY(SELECT DISTINCT g FROM UNNEST(p.authors) a, UNNEST(a.grid_ids) g) AS grids,
  ARRAY(SELECT DISTINCT c.name FROM UNNEST(p.category_for.first_level.full) c) AS fors
FROM `dimensions-ai.data_analytics.publications` p
```

The "pre-collapse to arrays in one scan" pattern in `focal_partner_dominant_for.sql` is worth copying for any focal-institution analysis — one scan of publications instead of three.

---

## 2. Building shared tables (cost-aware SQL)

### Patterns we used

**Window functions for ranking.** `ROW_NUMBER() OVER (PARTITION BY grid_a ORDER BY n_copublications DESC)` gives the partner's rank within their own list. Compute *all* rankings in one query, filter to the focal-relevant rows later.

**Directed pairs storage.** For asymmetric ranking, store `(A, B)` and `(B, A)` as separate rows. Doubles row count but makes `WHERE grid_a = X` work for any focal X without conditional logic.

**Mega-collaboration cap.** Papers with >100 distinct affiliations contribute `100 * 99 = 9,900` directed pairs each — they dwarf everything. Filter `WHERE n_grids BETWEEN 2 AND 100` to exclude them entirely.

**Fractional weighting.** A paper with K distinct affiliations contributes `1 / (K - 1)` per pair, so total weight per institution = K. Avoids consortium papers drowning small partnerships.

### Cost discipline

```bash
# Always before running:
bq --project_id=ds-consultancy-gbq query --use_legacy_sql=false --dry_run < my.sql

# Heuristic budget: anything > 50 GB scan, refactor first.
# Our actual scans: pairs table 2.65 GB, dominant-FoR 3.6 GB.
```

---

## 3. Python analysis layer (`scripts/`)

A small CLI tool per analysis, all sharing the same pattern:

```python
# 1. Read SQL from queries/, optionally substitute parameters
sql = SQL_PATH.read_text().replace(
    "DECLARE focal STRING DEFAULT 'grid.7340.0';",
    f"DECLARE focal STRING DEFAULT '{args.focal}';",
)

# 2. Dry-run first
dry = client.query(sql, job_config=bigquery.QueryJobConfig(dry_run=True))
print(f"will scan ~{dry.total_bytes_processed / 1e9:.2f} GB")

# 3. Execute, fetch as pandas
df = client.query(sql).result().to_dataframe(create_bqstorage_client=False)

# 4. Write to data/ as Parquet
df.to_parquet(out, index=False)
```

**Idempotent design.** Each script writes to a versioned filename (`reciprocal_rank__bath_full__top10000.parquet`); re-runs overwrite without losing prior runs of other focals.

**Local analysis script template.** See `scripts/bath_breakdowns.py`: reads the Parquet, slices by country / FoR / type, prints terminal summary tables, exports CSVs. Doesn't touch BigQuery at all — separation of query layer from analysis layer.

---

## 4. Static visualisation (matplotlib)

For the report-style asymmetry scatter (`scripts/plot_asymmetry.py`):

- Log-log scales (`ax.set_xscale("log")`, `ax.set_yscale("log")`) so the `y = x` diagonal is straight.
- Colour by categorical column (`for fname, sub in df.groupby("plot_for"): ax.scatter(...)`).
- Size by `sqrt(n) * scale_factor` so large partners stand out without saturating.
- Annotate only the top N by volume — full labels overwhelm.
- Save to `data/figures/` as 150 dpi PNG.

This was useful in the analysis repo; in the static site we re-built it as interactive Plot.js.

---

## 5. Observable Framework site

### Scaffold

```bash
mkdir my-site && cd my-site
git init -q

# Hand-written files (no `npm create` boilerplate to fight with):
cat > package.json <<EOF
{
  "name": "my-site",
  "type": "module",
  "scripts": {
    "dev":   "observable preview",
    "build": "observable build"
  },
  "dependencies": { "@observablehq/framework": "^1.13.0" }
}
EOF

cat > observablehq.config.js <<'EOF'
export default {
  title: "My Site",
  pages: [{name: "Overview", path: "/"}, {name: "Methodology", path: "/methodology"}],
  theme: ["air", "alt"],
  cleanUrls: true
};
EOF

cat > .gitignore <<'EOF'
node_modules/
dist/
src/.observablehq/cache/
.DS_Store
EOF

mkdir -p src/{data,components}
npm install --silent
```

### Page layout

Each page is a markdown file with embedded `js` code blocks. The reactive runtime re-runs cells whose inputs change.

```markdown
# Page title

Some intro prose.

```js
import {DuckDBClient} from "npm:@observablehq/duckdb";
import {rows} from "./components/duck.js";

const db = await DuckDBClient.of({
  agg: FileAttachment("data/bath_collaborators.parquet")
});
const all = rows(await db.query(`SELECT * FROM agg`));
```

```js
const minCopubs = view(Inputs.range([1, 200], {value: 10, label: "Min co-pubs"}));
```

```js
const filtered = all.filter(d => d.n_copublications >= minCopubs);
display(Plot.plot({
  x: {label: "Bath's rank →", type: "log"},
  y: {label: "Partner's rank ↑", type: "log"},
  marks: [Plot.dot(filtered, {x: "focal_rank_of_partner", y: "partner_rank_of_focal", r: "n_copublications", tip: true})]
}));
```
```

Cells with `view(Inputs.foo(...))` return a reactive value. Cells that reference that value re-run automatically.

### Bundling data

Drop a Parquet under `src/data/`. The build copies it to `dist/_file/` with a content hash. Access via `FileAttachment("data/my.parquet")`. ~500 KB is a comfortable upper bound for client-side loading.

---

## 6. Defensive helpers

`src/components/duck.js` — copy this verbatim into any DuckDB-WASM Observable site:

```js
export function rows(table) {
  const fields = table.schema.fields.map(f => f.name);
  const cols = Object.fromEntries(fields.map(f => [f, table.getChild(f)]));
  const out = new Array(table.numRows);
  for (let i = 0; i < table.numRows; i++) {
    const row = {};
    for (const f of fields) {
      let v = cols[f].get(i);
      if (typeof v === "bigint") v = Number(v);   // Int64 → Number
      row[f] = v;
    }
    out[i] = row;
  }
  return out;
}
```

This fixes two real bugs:
- **`table.toArray()` returns Arrow row proxies, not plain JS objects.** Accessing `row.field_name` can return the underlying TypedArray. Use the explicit `table.getChild(f).get(i)` pattern.
- **DuckDB `SUM()` over INT columns returns BIGINT.** Arrow surfaces them as JS BigInt. Mixing BigInt with Number in arithmetic throws — coerce on the way in.

Without this helper, headline cards display "370,998,0,0,0" (entire row coerced via TypedArray.toLocaleString) and stacked bars draw only the first segment because `pct_M / total` is NaN.

---

## 7. Reactive UI patterns

```js
// Single-select dropdown
const country = view(Inputs.select(allCountries, {value: "US", label: "Country"}));

// Multi-select checkbox group
const fors = view(Inputs.checkbox(allFors, {label: "FoRs (unchecked = all)"}));

// Range slider
const minSize = view(Inputs.range([0, 1000], {value: 50, step: 10, label: "Min size"}));

// Sortable, filterable table — built-in
display(Inputs.table(data, {
  columns: ["name", "n", "share"],
  header: {name: "Partner", n: "Co-pubs", share: "Share"},
  format: {share: x => `${(x * 100).toFixed(1)}%`},
  rows: 50,
  width: {name: 320}
}));
```

**Gotcha — string interpolation in markdown.** `${some_string}` is escaped to text. To inject DOM:

```js
// ❌ Renders literal "<b>foo</b>"
${"<b>foo</b>"}

// ✓ Renders bold foo
${html`<b>foo</b>`}
```

**Gotcha — `Plot.barX` auto-stacks** when y is ordinal and fill is categorical. Don't wrap in `Plot.stackX({...})` with a single arg — Plot reads the whole object as stack options and the mark gets no channels. Either trust the auto-stack or use `Plot.stackX({order: [...]}, {x, y, fill})` with the two-arg form.

**Gotcha — `percent: true` × explicit `domain: [0, 1]`.** `percent: true` rescales fractions by 100 for display; the explicit domain stays in raw units, so bars render ~100× too wide. Drop the domain and let Plot auto-compute.

**Gotcha — ` ```sql ` fences auto-execute** against DuckDB on any page. If you want to show SQL as syntax-highlighted code without running it, use ` ```sql run=false `.

---

## 8. Headless verification (`scripts/check_charts.mjs`)

```js
import {chromium} from "playwright";

const URL = process.env.URL ?? "http://127.0.0.1:3001";
const PAGES = ["/", "/partners", "/country", "/field", "/type"];

const browser = await chromium.launch();
let bad = 0;
for (const path of PAGES) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(`pageerror: ${e.message}`));
  page.on("console", m => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });

  await page.goto(`${URL}${path}`, {waitUntil: "networkidle", timeout: 60000});
  await page.waitForTimeout(3500);

  const figures = await page.$$eval("figure, svg", els =>
    els.map(el => ({rects: el.querySelectorAll("rect").length, circles: el.querySelectorAll("circle").length}))
       .filter(f => f.rects > 0 || f.circles > 0)
  );
  if (errors.length) bad++;
  // …print summary…
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
```

Run **pre-push** against `http://127.0.0.1:3001` (`npm run dev`), then **post-deploy** against the live URL. Both Bath sites caught real bugs this way before users did:
- Numbers rendered as "370,998,0,0,0" — caught by inspecting `<rect>` widths via Playwright.
- Stacked bars not stacking — caught the same way; bar widths summed to ~67,000 vs chart width 912 px.

---

## 9. Deploying to GitHub Pages

```bash
# One-time: create repo + push from local dir
gh repo create sjcporter/my-site --public --source=. --remote=origin --push \
   --description "Short description"

# One-time: enable Pages with Actions as the source
gh api -X POST repos/sjcporter/my-site/pages -f build_type=workflow
```

Workflow file at `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: ./dist }
      - id: deployment
        uses: actions/deploy-pages@v4
```

To wait for a deploy to finish from the CLI:

```bash
RUN_ID=$(gh run list --repo sjcporter/my-site --limit 1 --json databaseId --jq '.[0].databaseId')
until [ "$(gh run view "$RUN_ID" --repo sjcporter/my-site --json status --jq '.status')" = "completed" ]; do
  sleep 10
done
gh run view "$RUN_ID" --repo sjcporter/my-site --json conclusion
```

Both Bath sites deploy in ~1–2 minutes.

---

## 10. Working method

- **One bug = one commit** with a `Co-Authored-By:` trailer. Easy to revert.
- **Dry-run before billing.** Every unfamiliar BigQuery query.
- **Local build green ⇒ headless check green ⇒ push ⇒ live check green.** Four checkpoints, none of them skippable.
- **Reference both repos.** When you're stuck, the other repo probably already solved the same problem.

---

## Reference projects

- [`uk-senior-researcher-gender`](https://github.com/sjcporter/uk-senior-researcher-gender) — gender-of-seniors analysis by UK institution & field of research.
- [`research-collaboration-asymmetry`](https://github.com/sjcporter/research-collaboration-asymmetry) — University of Bath's co-authorship network with reciprocal-rank asymmetry.

The analysis repos (`suw_gender_analysis` and `institutional-collaboration`) live separately and are not published.
