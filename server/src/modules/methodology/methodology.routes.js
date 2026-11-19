import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { authGuard } from '../../middleware/authGuard.js';
import { AppError } from '../../middleware/errorHandler.js';
import { handle, parseOr400, idParam } from '../../middleware/route-helpers.js';
import {
  getEmissionsSummary,
  FACTOR_COLUMNS,
  getFactorForPeriod,
  resolveCorrectedFactor,
  factorUsabilityError,
  computeTco2e,
} from '../calculation/calculation.service.js';
import { ALL_ENTRY_CATEGORIES } from '../activity-entries/constants.js';
import { EMISSION_SOURCES, getCoverageDiagnostic, computeInventoryFingerprint } from './coverage.service.js';

const router = Router();
router.use(authGuard);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ.');

// ------------------------------------------------------------
// Registre des facteurs (lecture) et lots d'import.
// ------------------------------------------------------------
router.get(
  '/factors',
  handle(async (req, res) => {
    const category = typeof req.query.category === 'string' ? req.query.category : null;
    const result = await pool.query(
      `SELECT ${FACTOR_COLUMNS} FROM emission_factors
       WHERE ($1::text IS NULL OR category = $1)
       ORDER BY scope, category, label, valid_from`,
      [category],
    );
    res.json({ factors: result.rows });
  }),
);

router.get(
  '/factor-imports',
  handle(async (_req, res) => {
    const batches = await pool.query(
      `SELECT id, source_file, file_sha256, source_version, mode, accepted_count, rejected_count, unchanged_count, created_at
       FROM factor_import_batches ORDER BY id DESC`,
    );
    const rejections = await pool.query(
      'SELECT batch_id, sheet, cell, label, reason FROM factor_import_rejections ORDER BY batch_id DESC, id',
    );
    res.json({ batches: batches.rows, rejections: rejections.rows });
  }),
);

// ------------------------------------------------------------
// Couverture / diagnostic des sources pertinentes.
// ------------------------------------------------------------
router.get(
  '/coverage',
  handle(async (req, res) => {
    res.json(await getCoverageDiagnostic(req.auth.companyId));
  }),
);

const relevanceSchema = z.object({
  sourceCode: z.enum(EMISSION_SOURCES.map((s) => s.code)),
  status: z.enum(['pertinente', 'non_pertinente', 'a_evaluer']),
  justification: z.string().trim().max(2000).optional(),
});

router.put(
  '/coverage/relevance',
  handle(async (req, res) => {
    const data = parseOr400(relevanceSchema, req.body);
    if (data.status === 'non_pertinente' && !data.justification) {
      throw new AppError(400, "Une source déclarée non pertinente doit être justifiée (exclusion documentée).");
    }
    await pool.query(
      `INSERT INTO emission_source_relevance (company_id, source_code, status, justification, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (company_id, source_code) DO UPDATE SET status = EXCLUDED.status, justification = EXCLUDED.justification, updated_at = now()`,
      [req.auth.companyId, data.sourceCode, data.status, data.justification ?? null],
    );
    res.json(await getCoverageDiagnostic(req.auth.companyId));
  }),
);

// ------------------------------------------------------------
// Périmètre organisationnel.
// ------------------------------------------------------------
const boundarySchema = z.object({
  boundaryDescription: z.string().trim().max(5000).nullable().optional(),
  activityRole: z.enum(['consommateur', 'producteur_electricite', 'producteur_hydrogene']).optional(),
});

const boundaryItemSchema = z.object({
  itemType: z.enum(['site', 'entite', 'operation', 'actif_loue', 'exclusion']),
  name: z.string().trim().min(2).max(255),
  siteId: z.number().int().positive().nullable().optional(),
  included: z.boolean(),
  hasOperationalControl: z.boolean().nullable().optional(),
  ownershipPct: z.number().min(0).max(100).nullable().optional(),
  justification: z.string().trim().min(3).max(2000),
});

async function readBoundary(companyId) {
  const [company, items] = await Promise.all([
    pool.query('SELECT consolidation_approach, boundary_description, activity_role FROM companies WHERE id = $1', [companyId]),
    pool.query(
      `SELECT id, item_type, name, site_id, included, has_operational_control, ownership_pct, justification, created_at
       FROM organizational_boundary_items WHERE company_id = $1 ORDER BY item_type, id`,
      [companyId],
    ),
  ]);
  return {
    consolidationApproach: company.rows[0].consolidation_approach,
    approachNote:
      "Approche du contrôle opérationnel : 100 % des émissions des opérations dont l'entreprise a l'autorité d'appliquer ses politiques d'exploitation, quel que soit le pourcentage de détention. Les approches « part du capital » et « contrôle financier » ne sont pas prises en charge par MizanCarbone.",
    boundaryDescription: company.rows[0].boundary_description,
    activityRole: company.rows[0].activity_role,
    items: items.rows,
  };
}

router.get('/boundary', handle(async (req, res) => res.json(await readBoundary(req.auth.companyId))));

router.put(
  '/boundary',
  handle(async (req, res) => {
    const data = parseOr400(boundarySchema, req.body);
    await pool.query(
      `UPDATE companies SET
         boundary_description = CASE WHEN $2::boolean THEN $3 ELSE boundary_description END,
         activity_role = COALESCE($4, activity_role)
       WHERE id = $1`,
      [req.auth.companyId, data.boundaryDescription !== undefined, data.boundaryDescription ?? null, data.activityRole ?? null],
    );
    res.json(await readBoundary(req.auth.companyId));
  }),
);

router.post(
  '/boundary/items',
  handle(async (req, res) => {
    const data = parseOr400(boundaryItemSchema, req.body);
    if (data.siteId) {
      const site = await pool.query('SELECT id FROM sites WHERE id = $1 AND company_id = $2', [data.siteId, req.auth.companyId]);
      if (site.rows.length === 0) throw new AppError(400, "Ce site n'existe pas ou n'appartient pas à votre entreprise.");
    }
    if (data.included && data.hasOperationalControl === false) {
      throw new AppError(400, "Approche du contrôle opérationnel : un élément sans contrôle opérationnel ne peut pas être inclus dans le périmètre (il peut relever du Scope 3, ex. actifs loués).");
    }
    await pool.query(
      `INSERT INTO organizational_boundary_items (company_id, item_type, name, site_id, included, has_operational_control, ownership_pct, justification)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [req.auth.companyId, data.itemType, data.name, data.siteId ?? null, data.included, data.hasOperationalControl ?? null, data.ownershipPct ?? null, data.justification],
    );
    res.status(201).json(await readBoundary(req.auth.companyId));
  }),
);

router.delete(
  '/boundary/items/:itemId',
  handle(async (req, res) => {
    const id = idParam(req, 'itemId');
    const r = await pool.query('DELETE FROM organizational_boundary_items WHERE id = $1 AND company_id = $2 RETURNING id', [id, req.auth.companyId]);
    if (r.rows.length === 0) throw new AppError(404, 'Élément introuvable.');
    res.status(204).end();
  }),
);

// ------------------------------------------------------------
// Politique de recalcul de l'année de référence.
// ------------------------------------------------------------
const policySchema = z.object({
  thresholdPct: z.number().positive().max(100).nullable(),
  policyNotes: z.string().trim().max(5000).nullable().optional(),
});

const reviewSchema = z.object({
  triggerType: z.enum(['changement_structurel', 'changement_methodologique', 'correction_erreur']),
  description: z.string().trim().min(10).max(5000),
  estimatedImpactTco2e: z.number().min(-1e9).max(1e9),
});

const decisionSchema = z.object({
  decision: z.enum(['recalcul_valide', 'recalcul_non_retenu']),
  note: z.string().trim().min(5).max(5000),
});

export const BASE_YEAR_POLICY_NOTE =
  "Le GHG Protocol demande de recalculer les émissions de l'année de référence en cas de changement structurel significatif (acquisition, cession, externalisation), de changement méthodologique significatif ou de correction d'erreur significative, en tenant compte de l'effet cumulé de plusieurs changements. Il ne fixe pas de seuil chiffré universel : le seuil de significativité est choisi et documenté par l'entreprise. Une variation normale de production n'est pas un motif de recalcul.";

// Recalcul de l'inventaire de l'année de référence avec les données ACTUELLES
// et le registre actuel (y compris les facteurs correctifs). Ne modifie
// aucun résultat enregistré : produit une version, conservée à part.
export async function computeBaseYearInventory(companyId, baseYear, client = pool) {
  const entries = await client.query(
    `SELECT ae.id, ae.site_id, ae.factor_code, ae.quantity, ae.period_start, ae.period_end, er.tco2e AS stored_tco2e
     FROM activity_entries ae
     LEFT JOIN emission_results er ON er.activity_entry_id = ae.id
     WHERE ae.company_id = $1 AND ae.deleted_at IS NULL AND ae.material_label IS NULL
       AND ae.factor_code NOT LIKE 'scope3_ratio_%'
       AND ae.period_start >= make_date($2, 1, 1) AND ae.period_end <= make_date($2, 12, 31)
     ORDER BY ae.id`,
    [companyId, baseYear],
  );
  // Périmètre enregistré. Seul un élément de type « site » déclaré exclu
  // retire les données de tout le site. L'exclusion d'un équipement, d'une
  // opération, d'un actif loué ou d'une entité associée à un site ne peut
  // pas être rapportée automatiquement aux lignes de données : elle est
  // signalée, jamais étendue à tout le site.
  const items = await client.query(
    `SELECT id, item_type, name, site_id, included FROM organizational_boundary_items
     WHERE company_id = $1 ORDER BY id`,
    [companyId],
  );
  const siteItems = items.rows.filter((i) => i.item_type === 'site' && i.site_id !== null);
  const excludedSiteIds = [...new Set(siteItems.filter((i) => !i.included).map((i) => i.site_id))];
  const conflictingSiteIds = excludedSiteIds.filter((id) => siteItems.some((i) => i.site_id === id && i.included));
  const partialExclusions = items.rows
    .filter((i) => !i.included && i.item_type !== 'site')
    .map((i) => ({ itemId: i.id, itemType: i.item_type, name: i.name, siteId: i.site_id }));
  const totals = { scope1: 0, scope2LocationBased: 0, scope3: 0 };
  const lines = [];
  for (const e of entries.rows) {
    if (e.site_id !== null && excludedSiteIds.includes(e.site_id)) {
      lines.push({ entryId: e.id, siteId: e.site_id, excluded: true, storedTco2e: e.stored_tco2e === null ? null : Number(e.stored_tco2e), recalculatedTco2e: null, issue: null });
      continue;
    }
    const selected = await getFactorForPeriod(e.factor_code, ALL_ENTRY_CATEGORIES, e.period_start, e.period_end, client);
    const factor = selected ? await resolveCorrectedFactor(selected, client) : null;
    const unusable = factor ? factorUsabilityError(factor) : 'Aucun facteur pour la période.';
    const tco2e = factor && !unusable ? computeTco2e(e.quantity, factor.value_kgco2e) : null;
    if (tco2e !== null) {
      if (factor.scope === 1) totals.scope1 += tco2e;
      else if (factor.scope === 2 && factor.category === 'electricite_location_based') totals.scope2LocationBased += tco2e;
      else if (factor.scope === 3) totals.scope3 += tco2e;
    }
    lines.push({
      entryId: e.id,
      siteId: e.site_id,
      excluded: false,
      factorId: factor?.id ?? null,
      factorLabel: factor?.label ?? null,
      correctedFrom: factor && selected && factor.id !== selected.id ? selected.id : null,
      storedTco2e: e.stored_tco2e === null ? null : Number(e.stored_tco2e),
      recalculatedTco2e: tco2e,
      issue: unusable,
    });
  }
  // Un recalcul où une ligne du périmètre n'est plus calculable est
  // INCOMPLET : il ne peut pas être validé (sinon la référence baisserait
  // artificiellement d'une ligne simplement devenue non calculable).
  const incompleteLines = lines.filter((l) => !l.excluded && l.issue);
  const blockingReasons = [];
  if (incompleteLines.length > 0) {
    blockingReasons.push(`${incompleteLines.length} donnée(s) de l'année de référence n'ont plus de facteur utilisable (${incompleteLines.map((l) => `donnée n° ${l.entryId} : ${l.issue}`).join(' ; ')})`);
  }
  if (conflictingSiteIds.length > 0) {
    blockingReasons.push(`périmètre contradictoire : le(s) site(s) ${conflictingSiteIds.join(', ')} sont déclarés à la fois inclus et exclus`);
  }
  return {
    ...totals,
    totalScope12LocationBased: totals.scope1 + totals.scope2LocationBased,
    lines,
    excludedSiteIds,
    partialExclusions,
    partialExclusionsNote: partialExclusions.length > 0
      ? "Exclusions d'équipement, d'opération ou d'actif non rapportées automatiquement aux données : retirez ou corrigez vous-même les lignes concernées avant de valider."
      : null,
    excludedLineCount: lines.filter((l) => l.excluded).length,
    complete: blockingReasons.length === 0,
    blockingReasons,
    incompleteLines: incompleteLines.map((l) => ({ entryId: l.entryId, issue: l.issue })),
    hasData: lines.some((l) => l.recalculatedTco2e !== null),
  };
}

async function latestBaseYearVersion(companyId, baseYear, client = pool) {
  const r = await client.query(
    'SELECT * FROM base_year_inventory_versions WHERE company_id = $1 AND base_year = $2 ORDER BY version_number DESC LIMIT 1',
    [companyId, baseYear],
  );
  return r.rows[0] ?? null;
}

async function baseYearTotals(companyId, baseYear) {
  if (!baseYear) return null;
  // Base de comparaison = dernière version validée, sinon les résultats enregistrés.
  const version = await latestBaseYearVersion(companyId, baseYear);
  if (version) {
    return {
      scope1: Number(version.scope1_tco2e),
      scope2LocationBased: Number(version.scope2_location_tco2e),
      scope3: Number(version.scope3_tco2e),
      totalScope12LocationBased: Number(version.total_scope12_tco2e),
      hasData: true,
      versionNumber: version.version_number,
    };
  }
  return storedBaseYearTotals(companyId, baseYear);
}

async function storedBaseYearTotals(companyId, baseYear) {
  if (!baseYear) return null;
  const r = await pool.query(
    `SELECT er.scope, ef.category, SUM(er.tco2e) AS total
     FROM emission_results er
     JOIN activity_entries ae ON ae.id = er.activity_entry_id
     JOIN emission_factors ef ON ef.id = er.emission_factor_id
     WHERE ae.company_id = $1 AND ae.deleted_at IS NULL AND ef.category <> 'scope3_ratio'
       AND ae.period_start >= make_date($2, 1, 1) AND ae.period_end <= make_date($2, 12, 31)
     GROUP BY er.scope, ef.category`,
    [companyId, baseYear],
  );
  let scope1 = 0;
  let scope2LocationBased = 0;
  let scope3 = 0;
  for (const row of r.rows) {
    if (row.scope === 1) scope1 += Number(row.total);
    else if (row.scope === 2 && row.category === 'electricite_location_based') scope2LocationBased += Number(row.total);
    else if (row.scope === 3) scope3 += Number(row.total);
  }
  return { scope1, scope2LocationBased, scope3, totalScope12LocationBased: scope1 + scope2LocationBased, hasData: r.rows.length > 0 };
}

async function previewReview(companyId, data) {
  const company = await pool.query('SELECT base_year, base_year_threshold_pct FROM companies WHERE id = $1', [companyId]);
  const { base_year: baseYear, base_year_threshold_pct: threshold } = company.rows[0];
  if (!baseYear) throw new AppError(400, "Aucune année de référence n'est définie dans le profil entreprise.");
  const totals = await baseYearTotals(companyId, baseYear);
  // Effet cumulé : changements examinés depuis le dernier recalcul validé
  // et non encore intégrés (en attente ou non retenus).
  const previous = await pool.query(
    `SELECT COALESCE(SUM(estimated_impact_tco2e), 0) AS cumulated
     FROM base_year_recalculation_reviews
     WHERE company_id = $1 AND base_year = $2 AND decision IN ('en_attente', 'recalcul_non_retenu')
       AND id > COALESCE((SELECT MAX(id) FROM base_year_recalculation_reviews WHERE company_id = $1 AND decision = 'recalcul_valide'), 0)`,
    [companyId, baseYear],
  );
  const base = totals?.totalScope12LocationBased ?? 0;
  const cumulatedImpact = Number(previous.rows[0].cumulated) + data.estimatedImpactTco2e;
  const impactPct = base > 0 ? (data.estimatedImpactTco2e / base) * 100 : null;
  const cumulativePct = base > 0 ? (cumulatedImpact / base) * 100 : null;
  let recommendation;
  if (!totals?.hasData || base === 0) recommendation = 'annee_reference_sans_donnees';
  else if (threshold === null || threshold === undefined) recommendation = 'seuil_non_defini';
  else recommendation = Math.abs(cumulativePct) >= Number(threshold) ? 'recalcul_recommande' : 'sous_le_seuil';
  return {
    baseYear,
    thresholdPct: threshold === null ? null : Number(threshold),
    baseYearTotals: totals,
    estimatedImpactTco2e: data.estimatedImpactTco2e,
    impactPct,
    cumulatedImpactTco2e: cumulatedImpact,
    cumulativePct,
    recommendation,
    basisNote: 'Base de comparaison : Scope 1 + Scope 2 location-based de l’année de référence (le Scope 3 estimé n’entre pas dans le seuil).',
  };
}

router.get(
  '/base-year',
  handle(async (req, res) => {
    const companyId = req.auth.companyId;
    const [company, reviews, legacy] = await Promise.all([
      pool.query('SELECT base_year, base_year_threshold_pct, base_year_policy_notes FROM companies WHERE id = $1', [companyId]),
      pool.query('SELECT * FROM base_year_recalculation_reviews WHERE company_id = $1 ORDER BY id DESC', [companyId]),
      pool.query('SELECT previous_base_year, new_base_year, reason, recalculated_at FROM base_year_recalculations WHERE company_id = $1 ORDER BY id DESC', [companyId]),
    ]);
    const versions = await pool.query(
      `SELECT id, base_year, version_number, review_id, origin, scope1_tco2e, scope2_location_tco2e, scope3_tco2e, total_scope12_tco2e, created_at
       FROM base_year_inventory_versions WHERE company_id = $1 ORDER BY base_year, version_number`,
      [companyId],
    );
    const c = company.rows[0];
    res.json({
      baseYear: c.base_year,
      thresholdPct: c.base_year_threshold_pct === null ? null : Number(c.base_year_threshold_pct),
      policyNotes: c.base_year_policy_notes,
      policyNote: BASE_YEAR_POLICY_NOTE,
      baseYearTotals: await baseYearTotals(companyId, c.base_year),
      reviews: reviews.rows,
      baseYearChanges: legacy.rows,
      versions: versions.rows,
    });
  }),
);

router.put(
  '/base-year/policy',
  handle(async (req, res) => {
    const data = parseOr400(policySchema, req.body);
    await pool.query('UPDATE companies SET base_year_threshold_pct = $2, base_year_policy_notes = COALESCE($3, base_year_policy_notes) WHERE id = $1', [
      req.auth.companyId,
      data.thresholdPct,
      data.policyNotes ?? null,
    ]);
    res.json({ ok: true });
  }),
);

router.get(
  '/base-year/recalculation-preview',
  handle(async (req, res) => {
    const c = await pool.query('SELECT base_year FROM companies WHERE id = $1', [req.auth.companyId]);
    const baseYear = c.rows[0].base_year;
    if (!baseYear) throw new AppError(400, "Aucune année de référence n'est définie dans le profil entreprise.");
    const current = await baseYearTotals(req.auth.companyId, baseYear);
    const recalculated = await computeBaseYearInventory(req.auth.companyId, baseYear);
    res.json({
      baseYear,
      current,
      recalculated,
      differenceScope12Tco2e: recalculated.totalScope12LocationBased - (current?.totalScope12LocationBased ?? 0),
    });
  }),
);

router.post(
  '/base-year/reviews/preview',
  handle(async (req, res) => {
    const data = parseOr400(reviewSchema, req.body);
    res.json(await previewReview(req.auth.companyId, data));
  }),
);

router.post(
  '/base-year/reviews',
  handle(async (req, res) => {
    const data = parseOr400(reviewSchema, req.body);
    const preview = await previewReview(req.auth.companyId, data);
    const fingerprint = await computeInventoryFingerprint(req.auth.companyId);
    const r = await pool.query(
      `INSERT INTO base_year_recalculation_reviews
         (company_id, base_year, trigger_type, description, estimated_impact_tco2e, base_year_total_tco2e, impact_pct,
          cumulative_impact_pct, threshold_pct, recommendation, snapshot, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        req.auth.companyId,
        preview.baseYear,
        data.triggerType,
        data.description,
        data.estimatedImpactTco2e,
        preview.baseYearTotals?.totalScope12LocationBased ?? null,
        preview.impactPct,
        preview.cumulativePct,
        preview.thresholdPct,
        preview.recommendation,
        { baseYearTotals: preview.baseYearTotals, inventoryFingerprint: fingerprint },
        req.auth.userId,
      ],
    );
    res.status(201).json({ review: r.rows[0], preview });
  }),
);

router.patch(
  '/base-year/reviews/:reviewId',
  handle(async (req, res) => {
    const id = idParam(req, 'reviewId');
    const data = parseOr400(decisionSchema, req.body);
    const { companyId, userId } = req.auth;
    const result = await withTransaction(async (client) => {
      // Une seule image cohérente de la base pour toute la transaction : le
      // contrôle porte exactement sur ce qui est enregistré, même si le
      // périmètre ou les données changent en parallèle.
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const r = await client.query(
        `UPDATE base_year_recalculation_reviews
         SET decision = $3, decision_note = $4, decided_by = $5, decided_at = now()
         WHERE id = $1 AND company_id = $2 AND decision = 'en_attente' RETURNING *`,
        [id, companyId, data.decision, data.note, userId],
      );
      if (r.rows.length === 0) throw new AppError(404, 'Examen introuvable ou déjà tranché (les décisions sont conservées, jamais modifiées).');
      const review = r.rows[0];
      if (data.decision !== 'recalcul_valide') return { review, version: null };

      // Version 1 = inventaire tel qu'enregistré avant le premier recalcul ;
      // chaque recalcul validé ajoute une version, aucune n'est écrasée.
      let latest = await latestBaseYearVersion(companyId, review.base_year, client);
      if (!latest) {
        const stored = await storedBaseYearTotalsWith(client, companyId, review.base_year);
        const ins = await client.query(
          `INSERT INTO base_year_inventory_versions
             (company_id, base_year, version_number, review_id, origin, scope1_tco2e, scope2_location_tco2e, scope3_tco2e, total_scope12_tco2e, lines, created_by)
           VALUES ($1, $2, 1, NULL, 'initiale', $3, $4, $5, $6, $7, $8) RETURNING *`,
          [companyId, review.base_year, stored.scope1, stored.scope2LocationBased, stored.scope3, stored.totalScope12LocationBased, JSON.stringify(stored.lines), userId],
        );
        latest = ins.rows[0];
      }
      const recalculated = await computeBaseYearInventory(companyId, review.base_year, client);
      if (!recalculated.complete) {
        throw new AppError(
          409,
          `Recalcul incomplet : ${recalculated.blockingReasons.join(' ; ')}. Corrigez avant de valider : la référence ne peut pas changer parce qu'une ligne devient non calculable ou que le périmètre est incohérent.`,
        );
      }
      const version = await client.query(
        `INSERT INTO base_year_inventory_versions
           (company_id, base_year, version_number, review_id, origin, scope1_tco2e, scope2_location_tco2e, scope3_tco2e, total_scope12_tco2e, lines, created_by, excluded_site_ids, partial_exclusions)
         VALUES ($1, $2, $3, $4, 'recalcul_valide', $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [
          companyId,
          review.base_year,
          latest.version_number + 1,
          review.id,
          recalculated.scope1,
          recalculated.scope2LocationBased,
          recalculated.scope3,
          recalculated.totalScope12LocationBased,
          JSON.stringify(recalculated.lines),
          userId,
          recalculated.excludedSiteIds,
          JSON.stringify(recalculated.partialExclusions),
        ],
      );
      return { review, version: version.rows[0] };
    });
    res.json(result);
  }),
);

async function storedBaseYearTotalsWith(client, companyId, baseYear) {
  const r = await client.query(
    `SELECT ae.id AS entry_id, er.scope, ef.category, er.tco2e, ef.id AS factor_id, ef.label
     FROM emission_results er
     JOIN activity_entries ae ON ae.id = er.activity_entry_id
     JOIN emission_factors ef ON ef.id = er.emission_factor_id
     WHERE ae.company_id = $1 AND ae.deleted_at IS NULL AND ef.category <> 'scope3_ratio'
       AND ae.period_start >= make_date($2, 1, 1) AND ae.period_end <= make_date($2, 12, 31)
     ORDER BY ae.id`,
    [companyId, baseYear],
  );
  const totals = { scope1: 0, scope2LocationBased: 0, scope3: 0 };
  for (const row of r.rows) {
    if (row.scope === 1) totals.scope1 += Number(row.tco2e);
    else if (row.scope === 2 && row.category === 'electricite_location_based') totals.scope2LocationBased += Number(row.tco2e);
    else if (row.scope === 3) totals.scope3 += Number(row.tco2e);
  }
  return {
    ...totals,
    totalScope12LocationBased: totals.scope1 + totals.scope2LocationBased,
    lines: r.rows.map((x) => ({ entryId: x.entry_id, factorId: x.factor_id, factorLabel: x.label, tco2e: Number(x.tco2e) })),
  };
}

// ------------------------------------------------------------
// Contrôle interne d'une donnée et avis de vérification externe.
// ------------------------------------------------------------
const assuranceSchema = z.object({
  providerName: z.string().trim().min(2).max(255),
  statementDate: dateSchema,
  scopeDescription: z.string().trim().min(5).max(5000),
  assuranceLevel: z.enum(['limitee', 'raisonnable', 'non_precise']),
  standardReference: z.string().trim().max(255).optional(),
  documentReference: z.string().trim().min(2).max(255),
});

router.get(
  '/assurance',
  handle(async (req, res) => {
    const companyId = req.auth.companyId;
    const [rows, fingerprint] = await Promise.all([
      pool.query('SELECT * FROM external_assurance_statements WHERE company_id = $1 ORDER BY statement_date DESC, id DESC', [companyId]),
      computeInventoryFingerprint(companyId),
    ]);
    res.json({
      currentFingerprint: fingerprint,
      note:
        "MizanCarbone ne réalise aucune vérification. Cet écran enregistre l'avis d'un organisme indépendant et la version de l'inventaire sur laquelle il porte. Toute modification ultérieure de l'inventaire rend l'avis non applicable à la version courante.",
      statements: rows.rows.map((s) => ({ ...s, appliesToCurrentInventory: s.inventory_fingerprint === fingerprint })),
    });
  }),
);

router.post(
  '/assurance',
  handle(async (req, res) => {
    const data = parseOr400(assuranceSchema, req.body);
    const companyId = req.auth.companyId;
    const [fingerprint, summary] = await Promise.all([computeInventoryFingerprint(companyId), getEmissionsSummary(companyId)]);
    const snapshot = {
      scope1Tco2e: summary.scope1Tco2e,
      scope2LocationBasedTco2e: summary.scope2LocationBasedTco2e,
      scope2MarketBasedTco2e: summary.scope2MarketBasedTco2e,
      scope3Tco2e: summary.scope3Tco2e,
    };
    const r = await pool.query(
      `INSERT INTO external_assurance_statements
         (company_id, provider_name, statement_date, scope_description, assurance_level, standard_reference,
          document_reference, inventory_fingerprint, inventory_snapshot, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [companyId, data.providerName, data.statementDate, data.scopeDescription, data.assuranceLevel, data.standardReference ?? null, data.documentReference, fingerprint, snapshot, req.auth.userId],
    );
    res.status(201).json({ statement: { ...r.rows[0], appliesToCurrentInventory: true } });
  }),
);

const controlSchema = z.object({
  status: z.enum(['non_controle', 'controle_interne_effectue', 'anomalie_signalee']),
  note: z.string().trim().max(2000).optional(),
});

const RESULT_STATUS_FOR_CONTROL = {
  non_controle: 'non_controle',
  controle_interne_effectue: 'controle_interne_effectue',
  anomalie_signalee: 'controle_interne_partiel',
};

router.patch(
  '/entries/:entryId/internal-control',
  handle(async (req, res) => {
    const id = idParam(req, 'entryId');
    const data = parseOr400(controlSchema, req.body);
    if (data.status === 'anomalie_signalee' && !data.note) throw new AppError(400, "Décrivez l'anomalie constatée.");
    const updated = await withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE activity_entries
         SET internal_control_status = $3, internal_control_note = $4, internal_control_by = $5, internal_control_at = now()
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL RETURNING id, internal_control_status, internal_control_note, internal_control_at`,
        [id, req.auth.companyId, data.status, data.note ?? null, req.auth.userId],
      );
      if (r.rows.length === 0) throw new AppError(404, 'Entrée introuvable.');
      await client.query('UPDATE emission_results SET verification_status = $2 WHERE activity_entry_id = $1', [id, RESULT_STATUS_FOR_CONTROL[data.status]]);
      return r.rows[0];
    });
    res.json({ entry: updated });
  }),
);

export default router;
