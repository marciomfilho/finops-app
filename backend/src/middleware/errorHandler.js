/**
 * Handler global de erros — sanitiza respostas antes de enviar ao cliente.
 * Nunca expõe stack traces ou detalhes de infraestrutura.
 * Requirements: 2.8, 11.2
 */

import { ENV } from '../config/env.js';

const SAFE_MESSAGES = {
  401: 'Não autenticado',
  403: 'Acesso negado',
  404: 'Recurso não encontrado',
  429: 'Limite de requisições excedido',
  503: 'Serviço temporariamente indisponível',
};

/**
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function errorHandler(err, req, res, next) {
  // Log interno completo — nunca enviado ao cliente
  console.error('[ErrorHandler]', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    user: req.user?.email,
  });

  const status = err.status || err.statusCode || 500;

  const body = {
    error: SAFE_MESSAGES[status] || 'Erro interno do servidor',
  };

  if (ENV.NODE_ENV === 'development') {
    body.detail = err.message;
  }

  res.status(status).json(body);
}
