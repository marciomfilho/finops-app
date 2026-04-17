/**
 * Rota de resumos de custo: GET /api/summaries
 * Requirements: 2.1, 11.3
 */

import { Router } from 'express';
import { getCostSummaries } from '../services/supabase.js';

const router = Router();

const DEFAULT_PERIOD = 30;
const MAX_PERIOD = 365;

/**
 * GET /api/summaries?period=30
 * Retorna resumos de custo do Supabase para o período informado.
 */
router.get('/', async (req, res, next) => {
  try {
    const rawPeriod = parseInt(req.query.period, 10);
    const period = Number.isNaN(rawPeriod)
      ? DEFAULT_PERIOD
      : Math.min(Math.max(rawPeriod, 1), MAX_PERIOD);

    const summaries = await getCostSummaries(period);

    return res.json({
      summaries,
      synced_at: new Date().toISOString(),
      count: summaries.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
