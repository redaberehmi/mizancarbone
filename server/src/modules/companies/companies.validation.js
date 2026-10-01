import { z } from 'zod';
import { SECTORS } from '../auth/auth.validation.js';

const currentYear = new Date().getFullYear();

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  sector: z.enum(SECTORS).optional(),
  headcount: z.number().int().positive().max(1_000_000).nullable().optional(),
  baseYear: z.number().int().min(2000).max(currentYear).nullable().optional(),
  // Chiffre d'affaires annuel — optionnel, sert uniquement au calcul de
  // l'intensité carbone (dashboard). Jamais requis pour utiliser le reste du produit.
  annualRevenueMad: z.number().positive().nullable().optional(),
  // Sert à évaluer "données manquantes" et "complétude des données" au dashboard —
  // tant que non renseigné, ces deux indicateurs restent explicitement indisponibles.
  reportingFrequency: z.enum(['mensuelle', 'trimestrielle', 'annuelle']).nullable().optional(),
  // Repli déclaratif pour le test d'éligibilité financement (Module 7) quand
  // annualRevenueMad n'est pas renseigné — le calcul automatique (Loi 53-00)
  // est alors impossible, jamais estimé à sa place.
  declaredSizeCategory: z.enum(['tpe', 'pme', 'ge']).nullable().optional(),
  // Obligatoire uniquement si baseYear change une valeur déjà existante
  // (exigence section 5, module 3 : jamais de changement silencieux).
  baseYearChangeReason: z.string().trim().min(5).max(1000).optional(),
});

export const siteSchema = z.object({
  name: z.string().trim().min(2).max(255),
  city: z.string().trim().max(128).optional(),
});
