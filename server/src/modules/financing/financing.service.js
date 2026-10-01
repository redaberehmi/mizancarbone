import { pool } from '../../config/db.js';
import { getEmissionsSummary } from '../calculation/calculation.service.js';

// ============================================================
// Dispositifs de financement — contenu maintenu manuellement en V1
// (brief, section 5, module 5 : "interface d'admin simple ou seed data,
// pas de scraping automatique"). Aucun programme n'est fabriqué : la table
// reste vide jusqu'à ce que des dispositifs vérifiés soient fournis, ajoutés
// par insertion SQL directe dans financing_programs — même logique que les
// autres tables "prêtes mais vides" du projet (carbon_tax_parameters,
// exchange_rates, ratios Scope 3).
// ============================================================
// ============================================================
// Classification TPE/PME/GE — Loi 53-00 "Charte de la PME" :
//   TPE  : effectif < 10 salariés
//   PME  : effectif <= 200 salariés ET (CA HT <= 75 000 000 MAD OU bilan <= 50 000 000 MAD)
//   au-delà : Grande Entreprise (GE)
// Le "bilan" comptable n'est pas collecté par l'application — seule la
// branche CA de la condition PME est testable. Cette base légale est solide
// mais ne garantit pas que Maroc PME/AMEE applique exactement les mêmes
// seuils pour Tatwir spécifiquement (non confirmé) — d'où CAVEAT ci-dessous,
// à afficher systématiquement à côté de tout résultat d'éligibilité.
// ============================================================
export const SIZE_CATEGORY_CAVEAT =
  "Classification calculée selon les seuils légaux de la Charte de la PME (Loi 53-00). Maroc PME/AMEE peuvent appliquer " +
  "des seuils propres au dispositif Tatwir Croissance Verte, non confirmés à ce jour malgré cette base légale — " +
  "à vérifier avant toute décision de candidature.";

const TPE_MAX_HEADCOUNT = 10;
const PME_MAX_HEADCOUNT = 200;
const PME_MAX_CA_MAD = 75_000_000;

// Retourne { category: 'tpe'|'pme'|'ge'|null, source: 'calcule'|'declare'|'indetermine' }
// — jamais une catégorie devinée : sans effectif ET CA, on retombe sur la
// déclaration de l'entreprise, sinon "indéterminé" explicite.
export function computeCompanySizeCategory(company) {
  const headcount = company.headcount === null || company.headcount === undefined ? null : Number(company.headcount);
  const revenue = company.annual_revenue_mad === null || company.annual_revenue_mad === undefined ? null : Number(company.annual_revenue_mad);

  if (headcount !== null) {
    if (headcount < TPE_MAX_HEADCOUNT) return { category: 'tpe', source: 'calcule' };
    if (headcount <= PME_MAX_HEADCOUNT && revenue !== null && revenue <= PME_MAX_CA_MAD) {
      return { category: 'pme', source: 'calcule' };
    }
    if (headcount > PME_MAX_HEADCOUNT) return { category: 'ge', source: 'calcule' };
    // effectif <= 200 mais CA inconnu ou > seuil : la branche "bilan" de la
    // condition PME n'est pas testable (donnée non collectée) — impossible
    // de trancher entre PME et GE sans plus d'info, jamais un choix arbitraire.
  }

  if (company.declared_size_category) return { category: company.declared_size_category, source: 'declare' };
  return { category: null, source: 'indetermine' };
}

// ============================================================
// Certains programmes ont leur PROPRE critère de taille, confirmé
// indépendamment comme distinct de la Loi 53-00 (ex. Tatwir Croissance
// Verte : seuils en CA uniquement, pas d'effectif). Quand un programme
// déclare tpe_max_ca_mad/pme_max_ca_mad, on l'utilise en priorité — jamais
// supposé identique à la Loi 53-00 par défaut. Un programme sans ces
// colonnes renseignées retombe sur le calcul générique.
// ============================================================
export function computeSizeCategoryForProgram(company, program) {
  if (program.tpe_max_ca_mad !== null && program.pme_max_ca_mad !== null) {
    const revenue = company.annual_revenue_mad === null || company.annual_revenue_mad === undefined ? null : Number(company.annual_revenue_mad);
    if (revenue !== null) {
      if (revenue <= Number(program.tpe_max_ca_mad)) return { category: 'tpe', source: 'calcule_programme' };
      if (revenue <= Number(program.pme_max_ca_mad)) return { category: 'pme', source: 'calcule_programme' };
      return { category: 'ge', source: 'calcule_programme' };
    }
    if (company.declared_size_category) return { category: company.declared_size_category, source: 'declare' };
    return { category: null, source: 'indetermine' };
  }

  const generic = computeCompanySizeCategory(company);
  return { category: generic.category, source: generic.source === 'calcule' ? 'calcule_loi5300' : generic.source };
}

const NEW_PROGRAM_WINDOW_DAYS = 30;
const SIZE_LABELS = { tpe: 'TPE', pme: 'PME', ge: 'grande entreprise' };

// ============================================================
// Recommandations personnalisées (Module 7, V1.5) — réordonne et explique,
// n'invente aucun score. Le taux mis en avant est TOUJOURS celui qui
// s'applique réellement à la catégorie de l'entreprise (ex. PME -> 80%,
// TPE -> 90% pour Tatwir) — jamais le taux maximum du programme toutes
// catégories confondues, qui induirait en erreur une entreprise PME en lui
// laissant croire au taux TPE.
// ============================================================
function getBestApplicableComponent(components, sizeCategory) {
  const applicable = components.filter(
    (c) => c.beneficiary_type === null || (sizeCategory !== null && c.beneficiary_type.toLowerCase() === sizeCategory),
  );
  let best = null;
  for (const c of applicable) {
    if (c.subsidy_rate_pct === null) continue;
    if (best === null || Number(c.subsidy_rate_pct) > Number(best.subsidy_rate_pct)) best = c;
  }
  return best;
}

function buildRecommendationReason(sizeCategory, bestComponent) {
  if (!bestComponent) return null;
  const beneficiaryPart = bestComponent.beneficiary_type ? ` (${bestComponent.beneficiary_type})` : '';
  return (
    `Vous êtes classé ${SIZE_LABELS[sizeCategory]} pour ce dispositif — il couvre jusqu'à ` +
    `${Number(bestComponent.subsidy_rate_pct)}% de vos frais de ${bestComponent.label.toLowerCase()}${beneficiaryPart}.`
  );
}

// La raison de "non déterminé" distingue deux cas bien différents : (a) le
// programme lui-même n'a aucun critère de taille confirmé (peut recevoir un
// message personnalisé via size_undetermined_reason — ex. PACT, un vrai
// doute, pas une donnée manquante de routine) ; (b) le programme a un
// critère mais l'entreprise n'a pas fourni de quoi le tester. Jamais le même
// message générique pour ces deux cas.
function buildUndeterminedReason(program, sizeResult) {
  if (program.size_undetermined_reason) return program.size_undetermined_reason;
  if (program.eligible_size_categories === null) {
    return 'Aucun critère de taille confirmé pour ce dispositif à ce jour.';
  }
  return "Renseignez le chiffre d'affaires (ou votre taille) dans le profil entreprise pour déterminer votre éligibilité à ce dispositif.";
}

// Un programme peut combiner plusieurs volets de financement (taux
// différents selon le mécanisme — investissement, conseil/expertise...) et
// couvrir plusieurs catégories de projets, indépendamment l'un de l'autre
// (Module 7, V1.5 — voir migration 1738000005000). Un volet dont le taux
// n'est pas encore confirmé reste en base (active=false) mais n'est jamais
// renvoyé par cette fonction — même discipline que les placeholders
// scope3_ratio_<secteur> : structurellement prêt, jamais affiché comme
// confirmé.
//
// Éligibilité (Module 7) : testée uniquement sur la taille d'entreprise
// (eligible_size_categories) — le secteur n'est pas filtré puisque les 10
// secteurs de la plateforme sont déjà tous industriels. "Nouveau" = ajouté/
// modifié il y a moins de 30 jours ET éligible pour l'entreprise ET
// alerts_eligible=true — pas de suivi "vu/pas vu" par utilisateur en V1.5
// (limitation connue, cohérente avec l'absence de notifications push/email
// déjà actée).
//
// alerts_eligible (cadrage V1.5) : n'est JAMAIS dérivé automatiquement du
// statut des lignes financing_program_rules — un programme peut avoir une
// hypothèse non confirmée sur un point secondaire et rester alerts_eligible
// (ex. Tatwir), ou avoir des règles confirmées mais rester exclu si un fait
// structurant est contesté (ex. PACT'Décarbonation/Eau : contradiction sur
// le plafond lui-même, possible refonte du programme). C'est un jugement
// délibéré, jamais une règle mécanique sur le registre.
export async function listActiveFinancingPrograms(companyId) {
  const [programs, company] = await Promise.all([
    pool.query(
      `SELECT id, name, description, eligibility, source_url, eligible_size_categories,
              tpe_max_ca_mad, pme_max_ca_mad, size_rule_source, non_automated_conditions,
              alerts_eligible, application_deadline, deadline_note, current_edition_label,
              size_undetermined_reason, updated_at
       FROM financing_programs
       WHERE active = true`,
    ),
    pool.query(
      `SELECT headcount, annual_revenue_mad, declared_size_category FROM companies WHERE id = $1`,
      [companyId],
    ),
  ]);

  const companyRow = company.rows[0] ?? {};
  const now = new Date();
  const programIds = programs.rows.map((p) => p.id);

  const [components, categories, rules] = await Promise.all([
    pool.query(
      `SELECT financing_program_id, label, beneficiary_type, subsidy_rate_pct, cap_amount_mad, notes, source
       FROM financing_program_components
       WHERE active = true AND financing_program_id = ANY($1)
       ORDER BY label, beneficiary_type NULLS FIRST`,
      [programIds],
    ),
    pool.query(
      `SELECT financing_program_id, label
       FROM financing_program_categories
       WHERE financing_program_id = ANY($1)
       ORDER BY label`,
      [programIds],
    ),
    pool.query(
      `SELECT financing_program_id, rule_key, rule_label, rule_detail, primary_source, verified_at, verified_by, status, expires_at, rule_type
       FROM financing_program_rules
       WHERE financing_program_id = ANY($1)
       ORDER BY verified_at DESC`,
      [programIds],
    ),
  ]);

  const enriched = programs.rows.map((program) => {
    const sizeResult = computeSizeCategoryForProgram(companyRow, program);
    const eligible =
      program.eligible_size_categories === null || sizeResult.category === null
        ? null
        : program.eligible_size_categories.includes(sizeResult.category);
    const isNew = (now - new Date(program.updated_at)) / (1000 * 60 * 60 * 24) <= NEW_PROGRAM_WINDOW_DAYS;
    const programComponents = components.rows.filter((c) => c.financing_program_id === program.id);
    const bestComponent = eligible === true ? getBestApplicableComponent(programComponents, sizeResult.category) : null;

    // tier 1 = éligible, 2 = non déterminé, 3 = non éligible — sert au tri,
    // pas affiché tel quel (le regroupement visuel se fait côté frontend).
    const tier = eligible === true ? 1 : eligible === null ? 2 : 3;

    return {
      ...program,
      components: programComponents,
      categories: categories.rows.filter((c) => c.financing_program_id === program.id).map((c) => c.label),
      rules: rules.rows.filter((r) => r.financing_program_id === program.id),
      companySizeCategory: sizeResult.category,
      companySizeCategorySource: sizeResult.source,
      eligible,
      isNew: isNew && eligible === true && program.alerts_eligible === true,
      tier,
      recommendationReason: eligible === true ? buildRecommendationReason(sizeResult.category, bestComponent) : null,
      undeterminedReason: eligible === null ? buildUndeterminedReason(program, sizeResult) : null,
      bestApplicableRatePct: bestComponent ? Number(bestComponent.subsidy_rate_pct) : null,
    };
  });

  // Tri par pertinence : éligible d'abord, puis non déterminé, puis non
  // éligible ; à l'intérieur du niveau éligible, le taux applicable le plus
  // élevé en premier (jamais un taux global du programme qui ne
  // correspondrait pas à la catégorie réelle de l'entreprise).
  enriched.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.tier === 1) return (b.bestApplicableRatePct ?? 0) - (a.bestApplicableRatePct ?? 0);
    return new Date(b.updated_at) - new Date(a.updated_at);
  });

  return {
    sizeCategoryCaveat: SIZE_CATEGORY_CAVEAT,
    programs: enriched,
  };
}

// ============================================================
// Taxe carbone nationale — simulateur (brief, module 5). Les paramètres
// (rate_per_tco2e, threshold_tco2e, taxable_scopes) restent indicatifs tant
// que la Loi de Finances 2026 n'est pas pleinement publiée/stabilisée —
// cette mise en garde doit rester visible même une fois des valeurs réelles
// configurées, pas seulement pendant l'état vide.
//
// Le périmètre de scopes soumis à la taxe (Scope 1 seul ? 1+2 ? 1+2+3 ?)
// n'est spécifié nulle part dans le brief — c'est une hypothèse, jamais une
// certitude, donc jamais figée dans le code : elle vient exclusivement de
// carbon_tax_parameters.taxable_scopes, au même titre que le taux.
// ============================================================
async function getCurrentCarbonTaxParameters() {
  const result = await pool.query(
    `SELECT id, rate_per_tco2e, threshold_tco2e, taxable_scopes, source, valid_from
     FROM carbon_tax_parameters
     WHERE valid_to IS NULL
     ORDER BY valid_from DESC LIMIT 1`,
  );
  return result.rows[0] || null;
}

export async function getCarbonTaxParametersStatus() {
  const parameters = await getCurrentCarbonTaxParameters();
  if (!parameters) {
    return { available: false };
  }
  return {
    available: true,
    ratePerTco2e: Number(parameters.rate_per_tco2e),
    thresholdTco2e: parameters.threshold_tco2e === null ? null : Number(parameters.threshold_tco2e),
    taxableScopes: parameters.taxable_scopes,
    source: parameters.source,
    validFrom: parameters.valid_from,
  };
}

function sumTaxableScopes(breakdown, taxableScopes) {
  let total = 0;
  if (taxableScopes.includes(1)) total += breakdown.scope1Tco2e;
  if (taxableScopes.includes(2)) total += breakdown.scope2LocationBasedTco2e;
  if (taxableScopes.includes(3)) total += breakdown.scope3Tco2e;
  return total;
}

// Le détail par scope est toujours renvoyé, même sans paramètres configurés
// — pour que l'UI puisse montrer "vos émissions sont déjà calculées" sans
// présupposer QUEL périmètre sera retenu (ça, seule la LF2026 le dira). Le
// total taxable n'est calculé qu'une fois taxable_scopes réellement défini.
export async function simulateCarbonTax(companyId) {
  const summary = await getEmissionsSummary(companyId);
  const breakdown = {
    scope1Tco2e: summary.scope1Tco2e,
    scope2LocationBasedTco2e: summary.scope2LocationBasedTco2e,
    scope3Tco2e: summary.scope3Tco2e,
  };

  const parameters = await getCurrentCarbonTaxParameters();
  if (!parameters) {
    return { available: false, breakdown };
  }

  const taxableScopes = parameters.taxable_scopes;
  const totalTco2eConsidered = sumTaxableScopes(breakdown, taxableScopes);
  const threshold = parameters.threshold_tco2e === null ? null : Number(parameters.threshold_tco2e);
  const aboveThreshold = threshold === null ? true : totalTco2eConsidered >= threshold;
  const estimatedTaxMad = aboveThreshold ? totalTco2eConsidered * Number(parameters.rate_per_tco2e) : 0;

  return {
    available: true,
    breakdown,
    taxableScopes,
    totalTco2eConsidered,
    ratePerTco2e: Number(parameters.rate_per_tco2e),
    thresholdTco2e: threshold,
    aboveThreshold,
    estimatedTaxMad,
    source: parameters.source,
    validFrom: parameters.valid_from,
  };
}
