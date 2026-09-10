import { z } from 'zod';

// Secteurs cibles de la plateforme. Les 4 premiers viennent du brief d'origine
// (PME/ETI exportatrices marocaines). Les 6 suivants sont les catégories
// officiellement couvertes par le règlement CBAM européen (CBAM_OFFICIAL_CATEGORIES,
// module cbam-prep) — ajoutées comme secteurs à part entière car une entreprise
// peut produire un bien CBAM sans appartenir à la "métallurgie" au sens large
// (ex. engrais, électricité, hydrogène). Utilisés aussi pour la logique
// d'affichage du module CBAM (section 5, module 4) et pour sector_naf_mapping /
// les ratios Scope 3 (voir seeds 002 et 003).
export const SECTORS = [
  'automobile',
  'textile',
  'agroalimentaire',
  'metallurgie',
  'fer_et_acier',
  'aluminium',
  'ciment',
  'engrais',
  'electricite',
  'hydrogene',
];

export const registerSchema = z.object({
  companyName: z.string().trim().min(2).max(255),
  sector: z.enum(SECTORS),
  headcount: z.number().int().positive().max(1_000_000).optional(),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z
    .string()
    .min(10, 'Le mot de passe doit contenir au moins 10 caractères.')
    .max(128),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});
