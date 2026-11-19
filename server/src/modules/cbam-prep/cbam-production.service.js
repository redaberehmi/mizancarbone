import { pool } from '../../config/db.js';

// ============================================================
// CBAM — émissions intrinsèques par procédé de production.
//
// Distinct du bilan organisationnel : les émissions d'un procédé sont celles
// des données d'activité EXPLICITEMENT rattachées à ce procédé (avec une
// part d'attribution documentée), divisées par la production du procédé.
// Jamais une division du bilan global de l'entreprise par les tonnes
// produites.
//
// Pris en charge : bien « simple » (aucun précurseur), procédé produisant un
// seul bien, émissions directes (Scope 1 rattachées) et indirectes
// (électricité réseau rattachée) calculées séparément, à partir de valeurs
// réelles de l'installation.
// Non pris en charge (signalé, aucun chiffre produit) : biens complexes avec
// précurseurs, procédés multi-produits, valeurs par défaut, chaleur mesurable
// importée/exportée, gaz résiduaires.
// ============================================================

export const CBAM_LEGAL_REFERENCES = [
  { act: 'Règlement (UE) 2023/956', subject: 'Établissement du MACF (CBAM) — acte de base', note: 'Modifié par le règlement (UE) 2025/2083 (simplification) ; version consolidée publiée.' },
  { act: 'Règlement (UE) 2025/2083', subject: 'Simplification et renforcement du CBAM' },
  { act: "Règlement d'exécution (UE) 2023/1773", subject: 'Obligations de rapport pendant la période TRANSITOIRE uniquement' },
  { act: "Règlement d'exécution (UE) 2025/2547", subject: 'Méthodes de calcul des émissions intrinsèques des marchandises' },
  { act: "Règlement d'exécution (UE) 2025/2546", subject: 'Application des principes de vérification' },
  { act: 'Règlement délégué (UE) 2025/2551', subject: 'Accréditation et vérification' },
  { act: "Règlement d'exécution (UE) 2025/2621", subject: 'Établissement des valeurs par défaut', note: "Corrigé par le règlement d'exécution (UE) 2026/1740 (mise à jour juillet 2026)." },
];
export const CBAM_REFERENCES_CHECKED_ON = '2026-11-18';
export const CBAM_REFERENCES_SOURCE = 'https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism/cbam-legislation-and-guidance_en';

// Codes NC de l'annexe I du règlement 2023/956 (version initiale). La
// version consolidée après 2025/2083 doit être consultée avant toute
// conclusion : le résultat est une INDICATION, jamais une décision
// d'assujettissement (qui dépend aussi des seuils, de l'origine, du régime
// douanier et du statut de l'importateur).
const CN_PREFIXES = [
  { category: 'ciment', prefixes: ['25070080', '25231000', '25232100', '25232900', '25233000', '25239000'] },
  { category: 'electricite', prefixes: ['27160000'] },
  { category: 'engrais', prefixes: ['28080000', '2814', '28342100', '3102', '3105'], exclusions: ['31056000'] },
  {
    category: 'fer_et_acier',
    prefixes: ['26011200', '72', '7301', '7302', '730300', '7304', '7305', '7306', '7307', '7308', '730900', '7310', '731100', '7318', '7326'],
    exclusions: ['72022', '72023000', '72025000', '72027000', '72028', '72029100', '72029200', '72029300', '72029910', '72029930', '72029980', '7204'],
  },
  { category: 'aluminium', prefixes: ['7601', '7603', '7604', '7605', '7606', '7607', '7608', '76090000', '7610', '76110000', '7612', '76130000', '7614', '7616'] },
  { category: 'hydrogene', prefixes: ['28041000'] },
];

export const CN_CHECK_NOTE =
  "Indication fondée sur la liste des codes NC de l'annexe I du règlement (UE) 2023/956 (version initiale). À confirmer sur la version consolidée après le règlement (UE) 2025/2083 et selon la situation de l'importateur (seuils, origine, régime douanier). Le secteur déclaré de l'entreprise n'est pas utilisé.";

export function checkCnCode(raw) {
  const code = String(raw ?? '').replace(/\D/g, '');
  if (code.length < 4) return { code, status: 'code_invalide', category: null, note: 'Saisissez au moins les 4 premiers chiffres du code NC (8 chiffres recommandés).' };
  for (const group of CN_PREFIXES) {
    if (group.exclusions?.some((ex) => code.startsWith(ex))) continue;
    if (group.prefixes.some((p) => code.startsWith(p) || (code.length < p.length && p.startsWith(code)))) {
      const precise = group.prefixes.some((p) => code.startsWith(p));
      return {
        code,
        status: precise ? 'liste_annexe_I' : 'a_preciser',
        category: group.category,
        note: precise ? CN_CHECK_NOTE : 'Code trop court pour conclure : précisez les 8 chiffres.',
      };
    }
  }
  return { code, status: 'hors_liste_annexe_I', category: null, note: CN_CHECK_NOTE };
}

// Marchandises pour lesquelles l'annexe II du règlement 2023/956 ne retient
// que les émissions directes (indication, à confirmer sur le texte consolidé).
const DIRECT_ONLY_CATEGORIES = ['fer_et_acier', 'aluminium', 'hydrogene'];

export async function computeProcess(processId, companyId, client = pool) {
  const p = await client.query(
    `SELECT p.*, i.name AS installation_name, i.country, i.site_id AS installation_site_id FROM cbam_production_processes p
     JOIN cbam_installations i ON i.id = p.installation_id
     WHERE p.id = $1 AND p.company_id = $2`,
    [processId, companyId],
  );
  if (p.rows.length === 0) return null;
  const proc = p.rows[0];
  const links = await client.query(
    `SELECT l.activity_entry_id, l.share_pct, ae.site_id, ae.period_start, ae.period_end, ae.quantity, ae.factor_code,
            er.tco2e, ef.scope, ef.category, ef.label AS factor_label, ef.source, ef.represented_year
     FROM cbam_process_entries l
     JOIN activity_entries ae ON ae.id = l.activity_entry_id AND ae.deleted_at IS NULL
     LEFT JOIN emission_results er ON er.activity_entry_id = ae.id
     LEFT JOIN emission_factors ef ON ef.id = er.emission_factor_id
     WHERE l.process_id = $1`,
    [processId],
  );

  const cn = checkCnCode(proc.cn_code);
  const missing = [];
  const unsupported = [];
  if (cn.category === 'electricite') {
    unsupported.push("Électricité (code NC 2716) : la méthode CBAM dédiée (émissions par MWh d'électricité) n'est pas prise en charge ; aucun calcul en tonnes n'est produit.");
  }
  if (cn.status === 'hors_liste_annexe_I' || cn.status === 'code_invalide' || cn.status === 'a_preciser') {
    unsupported.push("Code NC absent de la liste de l'annexe I (ou incomplet) : aucun calcul d'émissions intrinsèques n'est produit pour ce produit.");
  }
  if (!proc.installation_site_id) missing.push("Site de l'installation non renseigné : l'origine des données ne peut pas être contrôlée.");
  const foreign = links.rows.filter((l) => proc.installation_site_id && l.site_id !== proc.installation_site_id);
  if (foreign.length > 0) unsupported.push(`${foreign.length} donnée(s) rattachée(s) proviennent d'un autre site que celui de l'installation.`);
  if (proc.has_precursors) unsupported.push('Bien complexe : les émissions intrinsèques des précurseurs ne sont pas prises en charge.');
  if (proc.produces_multiple_goods) unsupported.push("Procédé produisant plusieurs marchandises : l'attribution entre produits n'est pas prise en charge.");
  if (!proc.production_tonnes) missing.push('Niveau de production du procédé (tonnes) pour la période.');
  if (!proc.attribution_note) missing.push("Règle d'attribution des émissions au procédé (documentation).");
  if (links.rows.length === 0) missing.push('Aucune donnée d’activité rattachée au procédé.');
  const uncalculated = links.rows.filter((l) => l.tco2e === null);
  if (uncalculated.length > 0) missing.push(`${uncalculated.length} donnée(s) rattachée(s) sans résultat d'émission (facteur manquant ou inutilisable).`);

  let direct = 0;
  let indirect = 0;
  for (const l of links.rows) {
    if (l.tco2e === null) continue;
    const share = Number(l.share_pct) / 100;
    if (l.scope === 1) direct += Number(l.tco2e) * share;
    else if (l.scope === 2 && l.category === 'electricite_location_based') indirect += Number(l.tco2e) * share;
  }

  const supported = unsupported.length === 0;
  const complete = supported && missing.length === 0;
  const production = proc.production_tonnes ? Number(proc.production_tonnes) : null;
  return {
    id: proc.id,
    installationId: proc.installation_id,
    installationName: proc.installation_name,
    name: proc.name,
    productName: proc.product_name,
    cnCode: proc.cn_code,
    cnCheck: cn,
    periodStart: proc.period_start,
    periodEnd: proc.period_end,
    productionTonnes: production,
    hasPrecursors: proc.has_precursors,
    producesMultipleGoods: proc.produces_multiple_goods,
    attributionNote: proc.attribution_note,
    linkedEntries: links.rows.map((l) => ({
      activityEntryId: l.activity_entry_id,
      sharePct: Number(l.share_pct),
      scope: l.scope,
      category: l.category,
      factorLabel: l.factor_label,
      tco2e: l.tco2e === null ? null : Number(l.tco2e),
      attributedTco2e: l.tco2e === null ? null : (Number(l.tco2e) * Number(l.share_pct)) / 100,
    })),
    status: !supported ? 'non_pris_en_charge' : complete ? 'calcule_valeurs_reelles' : 'incomplet',
    unsupported,
    missing,
    attributedDirectTco2e: supported ? direct : null,
    attributedIndirectTco2e: supported ? indirect : null,
    specificDirectEmissions: complete ? direct / production : null,
    specificIndirectEmissions: complete ? indirect / production : null,
    indirectTreatmentNote: DIRECT_ONLY_CATEGORIES.includes(cn.category)
      ? "Pour cette catégorie, l'annexe II du règlement 2023/956 ne retiendrait que les émissions directes pour les certificats : les émissions indirectes sont affichées pour information (à confirmer sur le texte consolidé)."
      : 'Émissions indirectes calculées avec le facteur du réseau électrique rattaché ; les conditions d’usage d’un autre facteur (contrat, production propre) relèvent du règlement 2025/2547 et ne sont pas prises en charge.',
    defaultValuesNote: 'Valeurs par défaut (règlement 2025/2621 corrigé par 2026/1740) non intégrées : aucune valeur par défaut n’est proposée ni substituée.',
    verificationNote: "Les émissions intrinsèques déclarées pendant la période définitive doivent être vérifiées par un vérificateur accrédité (règlements 2025/2546 et 2025/2551). MizanCarbone ne vérifie pas et ne désigne aucun vérificateur.",
  };
}

export async function listProcesses(companyId) {
  const ids = await pool.query('SELECT id FROM cbam_production_processes WHERE company_id = $1 ORDER BY id', [companyId]);
  const out = [];
  for (const r of ids.rows) out.push(await computeProcess(r.id, companyId));
  return out;
}
