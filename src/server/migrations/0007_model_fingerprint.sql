-- Phase 51: record the fingerprint of the model that last wrote accepted state.
--
-- `model_version` alone was never evidence that a model was unchanged. It is
-- what an author declares, and before this phase there was no ADL syntax behind
-- it at all: every model resolved to the same platform constant, so editing
-- model content left the version identical and the startup compatibility guard
-- silent. Editing `OFFLINE_GRACE 30 DAYS` to `7 DAYS` had a security
-- consequence at exactly that point, because the authority derives its session
-- lifetime from that value and would begin issuing shorter sessions while every
-- already-running device still believed it had the longer window.
--
-- The fingerprint is a deterministic digest of the resolved model's own content,
-- computed during resolution. It is not a secret and discloses nothing: it is a
-- digest of the application's own declared shape, which the process already
-- serves. It is nullable because state written before this column existed has
-- no fingerprint; the authority backfills that case rather than refusing it, and
-- only refuses when a *present* fingerprint disagrees at an unchanged version.
--
-- This is a projection-table change and stays out of band, applied with the
-- migration role like every file here. Model migrations — the MIGRATION blocks
-- an ADL model declares — are a different mechanism entirely: they transform
-- records inside the authority's own atomic commit boundary and never emit SQL.

alter table adl_authority_models
  add column if not exists model_fingerprint text;
