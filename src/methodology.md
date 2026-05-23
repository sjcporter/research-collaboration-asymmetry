---
title: Methodology
toc: true
---

# Methodology

## Source data

All figures derive from the **Dimensions** scholarly database, queried via Google BigQuery in May 2026.

The cohort is **publications co-authored by the University of Bath** (GRID `grid.7340.0`) between **2020 and 2024**. For each publication we take the distinct set of GRID-identified affiliations from the `authors[].grid_ids` arrays. Publications with more than 100 distinct affiliations (consortium / mega-collaboration papers) are excluded entirely to avoid swamping the signal.

## Pairs table

`build_collab_pairs.sql` produces a **directed** institutional co-authorship table: each (A, B) ordered pair with A ≠ B appears once with `n_copublications` (count of shared papers) and `n_fractional` (sum of `1 / (n_distinct_affiliations - 1)` so that a paper with K distinct affiliations contributes a total weight of K per institution).

Directed storage means Bath's collaborators are just `WHERE grid_a = 'grid.7340.0'`; the partner's *own* collaborator ranking is `WHERE grid_a = partner_grid_id`.

Total table: ~22 million rows, ~995 MB on BigQuery.

## Asymmetry

For each partner Iy of Bath we record two ranks:

- `focal_rank_of_partner` — where Iy sits in Bath's own collaborator ranking (1 = Bath's top partner).
- `partner_rank_of_focal` — where Bath sits in Iy's collaborator ranking (1 = Bath is Iy's top partner).

Both ranks use raw co-publication count (`n_copublications`) as the ordering key. The **asymmetry** is `partner_rank_of_focal − focal_rank_of_partner`:

- Positive (often very positive) — Iy ranks Bath far lower than Bath ranks them. Bath is *peripheral* to Iy.
- Near zero — mutual relationship.
- Negative — Iy ranks Bath higher than Bath ranks them. Iy is *anchored* on Bath.

## Dominant field of research

`focal_partner_dominant_for.sql` re-scans publications 2020–2024 and, for each co-affiliated partner, counts how often each first-level Dimensions FoR (`category_for.first_level.full.name`) appears across the shared papers. The modal FoR is stored as `dominant_for`, along with its share of the pair's total FoR assignments. A publication may be assigned to multiple FoRs; each contributes to all of them.

Note: this is the FoR that *characterises the Bath × partner relationship*, not the partner's whole research portfolio. A general-purpose university whose Bath relationship is dominated by Biomedical work is not necessarily a Biomedical institution overall.

## Partner type

`partner_type` comes from GRID's `types` array. Each institution has one or more types from a small vocabulary (Education / Healthcare / Facility / Government / Company / Nonprofit / Other / Archive). The site uses the first listed type as `primary_type`.

## Filters and floors

Many views filter to partners with at least N distinct collaborators (`partner_n_collaborators >= 50` by default). This excludes one-off industry / SME partners where a single co-publication can put Bath at the top of an essentially-empty collaborator list. The slider in each view lets you change the floor.

## Caveats

- **Affiliation parsing.** Dimensions assigns GRIDs algorithmically from raw author affiliation strings. Missed or mis-attributed GRIDs are not corrected here.
- **Mega-collaborations.** Papers with very large author lists (>100 distinct affiliations) are excluded, but the cap is arbitrary; consortium-heavy fields will see less of their actual collaboration captured.
- **Mobility.** A researcher who moved between affiliations during 2020–2024 contributes to whatever GRID was attached to each paper at the time. Institutional ties are not de-duplicated.
- **Directionality.** Co-authorship is symmetric by definition; only the *ranking* is asymmetric. We are not measuring who initiated a collaboration or who funded it.
- **Recency.** Five years is a short window. Long-tail historical partners may not appear.

## Reproducibility

The data pipeline lives in a sibling analysis repo. The three SQL files that produce the parquet shipped with this site are reproduced below for review — expand each section to read.

<details>
<summary><b>1. <code>build_collab_pairs.sql</code></b> — global directed co-authorship pairs</summary>

Builds `ds-consultancy-gbq.sjcporter_consultancy.collab_pairs`. Scans Dimensions publications for 2020–2024, takes the distinct affiliations per paper, and emits one row per directed (A, B) pair with co-publication count and fractional weight. ~2.65 GB scan, 21.8M output rows.

```sql
-- Build a directed institutional co-authorship pairs table.
--
-- Source:   dimensions-ai.data_analytics.publications
-- Output:   ds-consultancy-gbq.sjcporter_consultancy.collab_pairs
--
-- Schema:   (grid_a STRING, grid_b STRING, n_copublications INT64, n_fractional FLOAT64)
--
-- Stored as DIRECTED pairs — each (A,B) appears once for A→B and once for B→A, so a query
-- "what are A's collaborators?" becomes simply `WHERE grid_a = A`. The two directions share
-- the same n_copublications value (co-authorship is symmetric); only the *ranking* differs
-- because A's ranking is over its own pairs and B's ranking is over its own.
--
-- Cost control:
--   * Restricted to publications in 2020-2024 (5 calendar years).
--   * Distinct grid_ids per publication: a paper with 50 distinct affiliations contributes 50*49 = 2450 directed pairs,
--     so mega-collaborations (CERN-style consortium papers) get fractional weighting to avoid drowning everything else.
--   * Pubs with > 100 distinct affiliations are excluded entirely.

CREATE OR REPLACE TABLE `ds-consultancy-gbq.sjcporter_consultancy.collab_pairs` AS
WITH pub_affiliations AS (
  -- one row per (publication, grid_id), distinct
  SELECT DISTINCT
    p.id AS publication_id,
    p.year,
    grid_id
  FROM `dimensions-ai.data_analytics.publications` p,
       UNNEST(authors) AS a,
       UNNEST(a.grid_ids) AS grid_id
  WHERE p.year BETWEEN 2020 AND 2024
    AND grid_id IS NOT NULL
),
pub_grid_count AS (
  SELECT publication_id, COUNT(*) AS n_grids
  FROM pub_affiliations
  GROUP BY publication_id
),
filtered AS (
  SELECT pa.publication_id, pa.grid_id, pgc.n_grids
  FROM pub_affiliations pa
  JOIN pub_grid_count pgc USING (publication_id)
  WHERE pgc.n_grids BETWEEN 2 AND 100   -- need ≥2 institutions to form a pair; cap at 100
),
pairs AS (
  -- directed pairs: every ordered (A,B) where A ≠ B on the same publication
  SELECT
    f1.grid_id AS grid_a,
    f2.grid_id AS grid_b,
    f1.n_grids
  FROM filtered f1
  JOIN filtered f2 USING (publication_id)
  WHERE f1.grid_id != f2.grid_id
)
SELECT
  grid_a,
  grid_b,
  COUNT(*) AS n_copublications,
  -- fractional weight: 1 / (n_grids - 1) so that a paper with K distinct affiliations
  -- contributes a total weight of K per institution (i.e. one unit of credit per partner)
  SUM(1.0 / (n_grids - 1)) AS n_fractional
FROM pairs
GROUP BY grid_a, grid_b;
```

</details>

<details>
<summary><b>2. <code>reciprocal_rank.sql</code></b> — focal institution + reciprocal ranks</summary>

For a chosen focal institution (Bath = `grid.7340.0`), returns its top-N partners alongside the partner's rank-of-focal in their own list. Joins to GRID for name, country, type.

```sql
-- Reciprocal-rank view of a focal institution's top collaborators.
--
-- Pattern: for focal Ix, find Ix's top N collaborators (Iy_1, Iy_2, ...).
-- For each Iy, look up where Ix ranks in *Iy's own* collaborator list.
-- The gap between the two ranks is the asymmetry — Iy may be Ix's #1
-- but Ix may be only Iy's #25.

DECLARE focal STRING DEFAULT 'grid.7340.0';   -- University of Bath
DECLARE top_n INT64  DEFAULT 50;

WITH focal_collabs AS (
  SELECT
    grid_b AS partner_grid,
    n_copublications,
    n_fractional,
    ROW_NUMBER() OVER (ORDER BY n_copublications DESC) AS focal_rank_of_partner
  FROM `ds-consultancy-gbq.sjcporter_consultancy.collab_pairs`
  WHERE grid_a = focal
),
top_partners AS (
  SELECT * FROM focal_collabs WHERE focal_rank_of_partner <= top_n
),
partner_full_rankings AS (
  SELECT
    grid_a AS partner_grid,
    grid_b AS their_collab,
    n_copublications,
    ROW_NUMBER() OVER (PARTITION BY grid_a ORDER BY n_copublications DESC) AS partner_rank
  FROM `ds-consultancy-gbq.sjcporter_consultancy.collab_pairs`
  WHERE grid_a IN (SELECT partner_grid FROM top_partners)
),
partner_rank_of_focal AS (
  SELECT partner_grid, partner_rank AS partner_rank_of_focal
  FROM partner_full_rankings
  WHERE their_collab = focal
),
partner_totals AS (
  SELECT
    grid_a AS partner_grid,
    COUNT(*)                  AS partner_n_collaborators,
    SUM(n_copublications)     AS partner_total_copubs
  FROM `ds-consultancy-gbq.sjcporter_consultancy.collab_pairs`
  WHERE grid_a IN (SELECT partner_grid FROM top_partners)
  GROUP BY grid_a
)
SELECT
  tp.focal_rank_of_partner,
  prf.partner_rank_of_focal,
  (prf.partner_rank_of_focal - tp.focal_rank_of_partner) AS rank_asymmetry,
  tp.partner_grid,
  g.name                                                 AS partner_name,
  g.address.country_code                                 AS partner_country,
  g.types                                                AS partner_type,
  tp.n_copublications,
  tp.n_fractional,
  pt.partner_n_collaborators,
  pt.partner_total_copubs,
  SAFE_DIVIDE(tp.n_copublications, pt.partner_total_copubs) AS share_of_partner_collab_volume
FROM top_partners tp
LEFT JOIN partner_rank_of_focal prf USING (partner_grid)
LEFT JOIN partner_totals       pt   USING (partner_grid)
LEFT JOIN `dimensions-ai.data_analytics.grid` g ON g.id = tp.partner_grid
ORDER BY tp.focal_rank_of_partner;
```

</details>

<details>
<summary><b>3. <code>focal_partner_dominant_for.sql</code></b> — modal field of research per partnership</summary>

Re-scans publications 2020–2024 where the focal institution is an affiliation, counts how often each first-level Dimensions FoR appears for each co-affiliated partner, and keeps the modal FoR per partner. Single scan of publications (~3.6 GB).

```sql
-- Dominant first-level Field of Research per (focal, partner) collaboration.

DECLARE focal STRING DEFAULT 'grid.7340.0';   -- University of Bath
DECLARE year_lo INT64 DEFAULT 2020;
DECLARE year_hi INT64 DEFAULT 2024;

WITH focal_pubs AS (
  -- Pre-collapse each publication to two arrays: distinct GRIDs on the pub, distinct first-level FoR names.
  -- Single scan of publications.
  SELECT
    p.id AS publication_id,
    ARRAY(
      SELECT DISTINCT g
      FROM UNNEST(p.authors) a, UNNEST(a.grid_ids) g
      WHERE g IS NOT NULL
    ) AS grids,
    ARRAY(
      SELECT DISTINCT cat.name
      FROM UNNEST(p.category_for.first_level.full) cat
      WHERE cat.name IS NOT NULL
    ) AS fors
  FROM `dimensions-ai.data_analytics.publications` p
  WHERE p.year BETWEEN year_lo AND year_hi
    AND EXISTS (
      SELECT 1 FROM UNNEST(p.authors) a, UNNEST(a.grid_ids) g WHERE g = focal
    )
),
partner_for_assignments AS (
  SELECT
    partner AS partner_grid,
    for_name,
    publication_id
  FROM focal_pubs,
       UNNEST(grids) AS partner,
       UNNEST(fors)  AS for_name
  WHERE partner != focal
),
pair_for_counts AS (
  SELECT
    partner_grid,
    for_name,
    COUNT(DISTINCT publication_id) AS n_pubs_in_for
  FROM partner_for_assignments
  GROUP BY 1, 2
),
ranked AS (
  SELECT
    partner_grid,
    for_name,
    n_pubs_in_for,
    SUM(n_pubs_in_for) OVER (PARTITION BY partner_grid)       AS n_for_assignments,
    COUNT(*)           OVER (PARTITION BY partner_grid)       AS n_distinct_for_assigned,
    ROW_NUMBER()       OVER (PARTITION BY partner_grid
                             ORDER BY n_pubs_in_for DESC, for_name) AS rk
  FROM pair_for_counts
)
SELECT
  partner_grid,
  for_name                                        AS dominant_for,
  n_pubs_in_for                                   AS dominant_for_n_pubs,
  SAFE_DIVIDE(n_pubs_in_for, n_for_assignments)   AS dominant_for_share,
  n_for_assignments                               AS n_for_assignments_total,
  n_distinct_for_assigned
FROM ranked
WHERE rk = 1
ORDER BY n_pubs_in_for DESC;
```

</details>

The site is built with [Observable Framework](https://observablehq.com/framework/); the ~400 KB parquet ships with the site and is loaded into DuckDB-WASM in your browser. All aggregations happen client-side.
