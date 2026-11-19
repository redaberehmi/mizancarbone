import { z } from 'zod';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ.');

const periodFields = {
  siteId: z.number().int().positive(),
  periodStart: dateSchema,
  periodEnd: dateSchema,
  sourceDocument: z.string().trim().max(255).optional(),
};

function withPeriodOrderCheck(schema) {
  return schema.refine((data) => data.periodEnd >= data.periodStart, {
    message: 'La fin de période doit être postérieure ou égale au début.',
    path: ['periodEnd'],
  });
}

// Saisie générique (Scope 1, 2 et 3). Selon la catégorie du facteur :
//  - quantité directe dans l'unité du facteur (cas général) ;
//  - montant en MAD pour un facteur en kgCO2e/kMAD (aucune conversion de
//    devise : quantité = montant / 1000) ;
//  - masse (t) × distance (km) pour un facteur de fret en tonne.km.
export const energyEntrySchema = withPeriodOrderCheck(
  z.object({
    siteId: z.number().int().positive().nullable().optional(),
    periodStart: dateSchema,
    periodEnd: dateSchema,
    sourceDocument: z.string().trim().max(255).optional(),
    factorCode: z.string().trim().min(1).max(96),
    quantity: z.number().positive().max(1_000_000_000_000).optional(),
    amountMad: z.number().positive().max(1_000_000_000_000).optional(),
    massTonnes: z.number().positive().max(1_000_000_000).optional(),
    distanceKm: z.number().positive().max(100_000).optional(),
    scope3Category: z.number().int().min(1).max(15).optional(),
    dataOrigin: z.enum(['mesuree', 'estimee']).optional(),
    description: z.string().trim().max(255).optional(),
    factorJustification: z.string().trim().max(2000).optional(),
  }),
);

export const rawMaterialEntrySchema = withPeriodOrderCheck(
  z.object({
    ...periodFields,
    materialLabel: z.string().trim().min(2).max(255),
    quantity: z.number().positive().max(1_000_000_000),
    supplier: z.string().trim().max(255).optional(),
  }),
);

export const listEntriesQuerySchema = z.object({
  siteId: z.coerce.number().int().positive().optional(),
  periodStart: dateSchema.optional(),
  periodEnd: dateSchema.optional(),
});

// null explicite pour retirer l'allocation produit d'une entrée.
export const productAllocationSchema = z.object({
  productAllocation: z.string().trim().min(1).max(255).nullable(),
});
