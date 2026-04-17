/**
 * Rota de recomendações: GET /api/recommendations
 * Requirements: 2.1
 */

import { Router } from 'express';
import { getSupabaseServiceClient } from '../services/supabase.js';

const router = Router();

/**
 * GET /api/recommendations
 * Retorna recomendações com status='open', ordenadas por prioridade.
 */
router.get('/', async (req, res, next) => {
  try {
    const supabase = await getSupabaseServiceClient();

    const { data, error } = await supabase
      .from('recommendations')
      .select('*')
      .eq('status', 'open')
      .order('priority', { ascending: true });

    if (error) {
      throw new Error(`[Supabase] getRecommendations: ${error.message}`);
    }

    return res.json({
      recommendations: data,
      count: data.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
