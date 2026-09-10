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

export const energyEntrySchema = withPeriodOrderCheck(
  z.object({
    ...periodFields,
    factorCode: z.string().trim().min(1).max(64),
    quantity: z.number().positive().max(1_000_000_000),
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
