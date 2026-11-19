import { pool } from '../../config/db.js';

// ============================================================
// Scope 2 market-based (GHG Protocol Scope 2 Guidance, 2015).
//
// Représentation sans double compte : la consommation d'électricité achetée
// est saisie UNE fois (entrées « électricité réseau » par site et période,
// qui portent le location-based). Les instruments contractuels sont des
// ALLOCATIONS de cette consommation, jamais une consommation en plus.
//
// Market-based d'une consommation =
//   Σ (volume couvert par un instrument ADMISSIBLE × facteur de l'instrument)
// + (volume restant × facteur de repli)
// Facteur de repli : aucun mix résiduel n'est publié pour le Maroc à notre
// connaissance ; le facteur réseau (location-based) est utilisé et cette
// absence est signalée (critère de qualité n° 8 : l'absence de mix
// résiduel doit être indiquée, avec le risque de double comptage).
//
// Un instrument n'est admissible que si l'entreprise a documenté le
// facteur, sa source, une pièce justificative ET déclaré les critères de
// qualité 1 à 5 (tableau 7.1). Un contrat « renouvelable » n'est jamais
// présumé admissible ni présumé à facteur nul.
// ============================================================

export const PURCHASE_INSTRUMENT_TYPES = [
  'certificat_attributs',
  'contrat_fourniture_direct',
  'contrat_fournisseur',
  'taux_fournisseur',
];

export const INSTRUMENT_LABELS = {
  certificat_attributs: "Certificats d'attributs énergétiques",
  contrat_fourniture_direct: 'Contrat de fourniture directe (ex. PPA, ligne directe)',
  contrat_fournisseur: 'Contrat de fourniture avec un fournisseur (électricité d’origine spécifiée)',
  taux_fournisseur: "Taux d'émission communiqué par le fournisseur",
  autoconsommation: 'Autoconsommation (production sur site consommée sur site)',
  vente_electricite: "Vente d'électricité produite",
};

export const QUALITY_CRITERIA = [
  { key: 'qc_conveys_attribute', label: "1. L'instrument transmet l'attribut « taux d'émission direct » de l'électricité produite" },
  { key: 'qc_unique_claim', label: "2. C'est le seul instrument revendiquant cet attribut pour ce volume" },
  { key: 'qc_retired_on_behalf', label: "3. Suivi et annulé (retiré) par ou pour le compte de l'entreprise" },
  { key: 'qc_vintage_close_to_period', label: '4. Émis et annulé au plus près de la période de consommation' },
  { key: 'qc_same_market', label: '5. Issu du même marché que les sites consommateurs' },
  {
    key: 'qc_supplier_delivered_basis',
    label: "6. (Taux ou contrat fournisseur) Facteur calculé sur l'électricité livrée, intégrant les certificats retirés pour les clients ; la production dont les attributs ont été cédés est comptée au mix résiduel",
    appliesTo: ['taux_fournisseur', 'contrat_fournisseur'],
  },
  {
    key: 'qc_direct_claims_transferred',
    label: "7. (Achat direct auprès d'un producteur) Tous les instruments portant la revendication sont transférés à l'entreprise seule ; l'électricité de l'installation n'est revendiquée par aucun autre utilisateur",
    appliesTo: ['contrat_fourniture_direct'],
  },
];

export function criteriaFor(instrumentType) {
  return QUALITY_CRITERIA.filter((q) => !q.appliesTo || q.appliesTo.includes(instrumentType));
}

export const RESIDUAL_MIX_NOTE =
  "Aucun mix résiduel n'est disponible pour le Maroc dans MizanCarbone : le volume non couvert par un instrument admissible est calculé avec le facteur réseau (location-based). Cette absence doit être indiquée : elle peut entraîner un double comptage des attributs entre consommateurs (GHG Protocol Scope 2, critère de qualité n° 8).";

export function evaluateAdmissibility(contract) {
  if (!PURCHASE_INSTRUMENT_TYPES.includes(contract.instrument_type)) {
    return { admissible: false, missing: [], informational: true };
  }
  const missing = [];
  if (contract.factor_kgco2e_per_kwh === null || contract.factor_kgco2e_per_kwh === undefined) missing.push("facteur d'émission de l'instrument");
  if (!contract.factor_source) missing.push('source du facteur');
  if (!contract.document_reference) missing.push('pièce justificative');
  for (const c of criteriaFor(contract.instrument_type)) {
    if (!contract[c.key]) missing.push(`critère ${c.label.split('.')[0]}`);
  }
  return { admissible: missing.length === 0, missing, informational: false };
}

function iso(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

export async function loadLocationBasedEntries(companyId, client = pool) {
  const result = await client.query(
    `SELECT ae.id, ae.site_id, ae.period_start, ae.period_end, ae.quantity,
            er.tco2e, ef.value_kgco2e, ef.label AS factor_label, ef.represented_year
     FROM activity_entries ae
     JOIN LATERAL (
       SELECT category FROM emission_factors ef2 WHERE ef2.code = ae.factor_code ORDER BY valid_from DESC LIMIT 1
     ) cat ON cat.category = 'electricite_location_based'
     LEFT JOIN emission_results er ON er.activity_entry_id = ae.id
     LEFT JOIN emission_factors ef ON ef.id = er.emission_factor_id
     WHERE ae.company_id = $1 AND ae.deleted_at IS NULL
     ORDER BY ae.period_start, ae.id`,
    [companyId],
  );
  return result.rows.map((r) => ({
    id: r.id,
    siteId: r.site_id,
    periodStart: iso(r.period_start),
    periodEnd: iso(r.period_end),
    kwh: Number(r.quantity),
    locationTco2e: r.tco2e === null ? null : Number(r.tco2e),
    gridFactor: r.value_kgco2e === null ? null : Number(r.value_kgco2e),
    gridFactorLabel: r.factor_label,
    gridFactorYear: r.represented_year,
  }));
}

// Entrées de consommation du même site entièrement contenues dans la
// période de l'instrument, et entrées qui la chevauchent partiellement.
export function matchEntries(contract, entries) {
  const start = iso(contract.period_start);
  const end = iso(contract.period_end);
  const sameSite = entries.filter((e) => e.siteId === contract.site_id);
  const contained = sameSite.filter((e) => e.periodStart >= start && e.periodEnd <= end);
  const partial = sameSite.filter(
    (e) => !(e.periodStart >= start && e.periodEnd <= end) && e.periodStart <= end && e.periodEnd >= start,
  );
  return { contained, partial, consumptionKwh: contained.reduce((s, e) => s + e.kwh, 0) };
}

// Allocation au prorata de chaque instrument d'achat sur les consommations
// qu'il couvre entièrement. Utilisé pour contrôler qu'aucune consommation
// (site × période saisie) ne reçoit plus de kWh d'instruments qu'elle n'en
// a consommé — contrôle fait consommation par consommation, jamais en
// comparant le volume total d'un contrat annuel à un seul mois.
export function allocationByEntry(contracts, entries) {
  const byEntry = new Map(entries.map((e) => [e.id, 0]));
  for (const c of contracts) {
    if (!PURCHASE_INSTRUMENT_TYPES.includes(c.instrument_type)) continue;
    const { contained, partial, consumptionKwh } = matchEntries(c, entries);
    if (partial.length > 0 || contained.length === 0 || consumptionKwh === 0) continue;
    for (const e of contained) byEntry.set(e.id, byEntry.get(e.id) + (Number(c.volume_kwh) * e.kwh) / consumptionKwh);
  }
  return byEntry;
}

export function findOverAllocatedEntries(contracts, entries) {
  const alloc = allocationByEntry(contracts, entries);
  return entries.filter((e) => alloc.get(e.id) > e.kwh + 1e-6).map((e) => ({ ...e, allocatedKwh: alloc.get(e.id) }));
}

export async function computeMarketBased(companyId, client = pool) {
  const [entries, contractsResult] = await Promise.all([
    loadLocationBasedEntries(companyId, client),
    client.query(
      `SELECT c.*, s.name AS site_name FROM electricity_contracts c
       JOIN sites s ON s.id = c.site_id
       WHERE c.company_id = $1 ORDER BY c.period_start, c.id`,
      [companyId],
    ),
  ]);

  const allocated = new Map(entries.map((e) => [e.id, { admissibleKwh: 0, contractTco2e: 0 }]));
  const contracts = [];
  let selfConsumptionKwh = 0;
  let soldKwh = 0;

  for (const c of contractsResult.rows) {
    const base = {
      id: c.id,
      siteId: c.site_id,
      siteName: c.site_name,
      instrumentType: c.instrument_type,
      instrumentLabel: INSTRUMENT_LABELS[c.instrument_type],
      supplier: c.supplier,
      installation: c.installation,
      technology: c.technology,
      periodStart: iso(c.period_start),
      periodEnd: iso(c.period_end),
      volumeKwh: Number(c.volume_kwh),
      factorKgco2ePerKwh: c.factor_kgco2e_per_kwh === null ? null : Number(c.factor_kgco2e_per_kwh),
      factorSource: c.factor_source,
      documentReference: c.document_reference,
      qualityCriteria: Object.fromEntries(criteriaFor(c.instrument_type).map((q) => [q.key, c[q.key]])),
      notes: c.notes,
    };

    if (c.instrument_type === 'autoconsommation') {
      selfConsumptionKwh += base.volumeKwh;
      contracts.push({ ...base, status: 'information', statusDetail: "Électricité produite et consommée sur site : pas d'émission Scope 2. Si elle provient d'un combustible, les émissions sont en Scope 1 (saisie du combustible)." });
      continue;
    }
    if (c.instrument_type === 'vente_electricite') {
      soldKwh += base.volumeKwh;
      contracts.push({ ...base, status: 'information', statusDetail: "Électricité vendue : enregistrée pour information, jamais déduite des émissions." });
      continue;
    }

    const { admissible, missing } = evaluateAdmissibility(c);
    const { contained, partial, consumptionKwh } = matchEntries(c, entries);

    if (partial.length > 0) {
      contracts.push({ ...base, status: 'periode_incompatible', statusDetail: "Une saisie de consommation du site chevauche partiellement la période de l'instrument : alignez les périodes. L'instrument n'est pas appliqué." });
      continue;
    }
    if (contained.length === 0 || consumptionKwh === 0) {
      contracts.push({ ...base, status: 'sans_consommation', statusDetail: "Aucune consommation saisie pour ce site sur cette période : l'instrument ne peut pas être alloué." });
      continue;
    }
    if (!admissible) {
      contracts.push({ ...base, status: 'non_admissible', missing, statusDetail: `Instrument non admissible (manque : ${missing.join(', ')}). Son volume est calculé avec le facteur de repli.` });
      continue;
    }
    // Contrôle de non-dépassement : la somme des allocations admissibles
    // d'une consommation ne peut pas dépasser cette consommation.
    const overflow = contained.some((e) => allocated.get(e.id).admissibleKwh + (base.volumeKwh * e.kwh) / consumptionKwh > e.kwh + 1e-6);
    if (base.volumeKwh > consumptionKwh + 1e-6 || overflow) {
      contracts.push({ ...base, status: 'surallocation', statusDetail: "Le volume des instruments dépasse la consommation saisie pour ce site et cette période : l'instrument n'est pas appliqué." });
      continue;
    }
    for (const e of contained) {
      const share = (base.volumeKwh * e.kwh) / consumptionKwh;
      const slot = allocated.get(e.id);
      slot.admissibleKwh += share;
      slot.contractTco2e += (share * base.factorKgco2ePerKwh) / 1000;
    }
    contracts.push({ ...base, status: 'admissible', statusDetail: 'Instrument appliqué au calcul market-based.' });
  }

  let totalTco2e = 0;
  let consumptionKwh = 0;
  let admissibleKwh = 0;
  let calculatedCount = 0;
  const lines = [];
  for (const e of entries) {
    consumptionKwh += e.kwh;
    const slot = allocated.get(e.id);
    if (e.locationTco2e === null || e.gridFactor === null) {
      lines.push({ entryId: e.id, siteId: e.siteId, periodStart: e.periodStart, periodEnd: e.periodEnd, kwh: e.kwh, marketTco2e: null, status: 'non_calcule' });
      continue;
    }
    const fallbackKwh = e.kwh - slot.admissibleKwh;
    const marketTco2e = slot.contractTco2e + (fallbackKwh * e.gridFactor) / 1000;
    totalTco2e += marketTco2e;
    admissibleKwh += slot.admissibleKwh;
    calculatedCount += 1;
    lines.push({
      entryId: e.id,
      siteId: e.siteId,
      periodStart: e.periodStart,
      periodEnd: e.periodEnd,
      kwh: e.kwh,
      admissibleKwh: slot.admissibleKwh,
      fallbackKwh,
      fallbackFactor: e.gridFactor,
      fallbackFactorLabel: e.gridFactorLabel,
      locationTco2e: e.locationTco2e,
      marketTco2e,
    });
  }

  let status;
  if (entries.length === 0) status = { status: 'manquant', needsVerification: false, hasUncalculatedEntries: false };
  else if (calculatedCount === 0) status = { status: 'non_calcule', needsVerification: false, hasUncalculatedEntries: true };
  else status = { status: totalTco2e === 0 ? 'zero_reel' : 'reel', needsVerification: false, hasUncalculatedEntries: calculatedCount < entries.length };

  return {
    totalTco2e,
    status,
    consumptionKwh,
    admissibleKwh,
    fallbackKwh: consumptionKwh - admissibleKwh,
    selfConsumptionKwh,
    soldKwh,
    residualMixAvailable: false,
    fallbackNote: RESIDUAL_MIX_NOTE,
    contracts,
    lines,
  };
}
