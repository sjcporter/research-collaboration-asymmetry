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

- Pairs table: `queries/build_collab_pairs.sql` in the analysis repo
- Focal reciprocal-rank query: `queries/reciprocal_rank.sql`
- Dominant FoR query: `queries/focal_partner_dominant_for.sql`
- Site is built with [Observable Framework](https://observablehq.com/framework/); the ~400 KB parquet ships with the site and is loaded into DuckDB-WASM in your browser. All aggregations happen client-side.
