import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generic template engine replacing {{curlies}}
 * @param {string} template
 * @param {Record<string, any>} data
 * @returns {string}
 */
function renderTemplate(template, data) {
  return template.replace(/\{\{([\w.]+)\}\}/g, (match, keyPath) => {
    return keyPath.split('.').reduce((/** @type {any} */ obj, /** @type {string} */ key) => obj && obj[key], data) || match;
  });
}

/**
 * @type {import('../../types.d.ts').ActionPlugin}
 */
export default async function generateMessageAction(item, config) {
  console.log(`Running generate_message for item: ${item.id}`);
  
  // Look for a template in config or a default one
  const templatePath = path.join(__dirname, '..', '..', 'config', 'templates', 'message.md');
  
  let template = 'Hello, I am interested in {{item.title}} priced at {{item.metadata.price}}.\n\nBest, {{config.persona.name}}';
  
  if (fs.existsSync(templatePath)) {
      template = fs.readFileSync(templatePath, 'utf8');
  }
  
  const rendered = renderTemplate(template, { item, config });
  
  return {
    message: 'Message generated successfully',
    content: rendered
  };
}
