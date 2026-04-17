/**
 * Rota de chat RAG: POST /api/chat
 * Requirements: 7.1, 7.3, 7.6
 */

import { Router } from 'express';
import { runRAGPipeline } from '../services/ragPipeline.js';

const router = Router();

const MAX_MESSAGE_LENGTH = 2000;

/**
 * POST /api/chat
 * Aceita { message, history[] }, executa o pipeline RAG e retorna a resposta.
 */
router.post('/', async (req, res, next) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Campo message é obrigatório e não pode ser vazio' });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        error: `Mensagem excede o limite de ${MAX_MESSAGE_LENGTH} caracteres`,
      });
    }

    if (!Array.isArray(history)) {
      return res.status(400).json({ error: 'Campo history deve ser um array' });
    }

    const result = await runRAGPipeline(message.trim(), history);

    return res.json({
      text: result.text,
      insights: result.insights,
      chunksUsed: result.chunksUsed,
      hasContext: result.hasContext,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
