/**
 * Interface pública do serviço de segredos.
 * Re-exporta getSecret e loadAllSecrets de config/secrets.js.
 * Requirements: 3.1, 3.2, 3.3
 */

export { getSecret, loadAllSecrets } from '../config/secrets.js';
