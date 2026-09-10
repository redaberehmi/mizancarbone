import { z } from 'zod';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ.');

export const scope3EstimateSchema = z
  .object({
    periodStart: dateSchema,
    periodEnd: dateSchema,
    amountMad: z.number().positive().max(1_000_000_000),
  })
  .refine((data) => data.periodEnd >= data.periodStart, {
    message: 'La fin de période doit être postérieure ou égale au début.',
    path: ['periodEnd'],
  });
