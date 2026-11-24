// Локальный плагин ESLint (C255). Политика — scripts/audit-domain-boundaries.js.
const { findingsFor, message } = require('../scripts/audit-domain-boundaries');

function checkSource(context, node, spec) {
  if (typeof spec !== 'string') return;
  for (const f of findingsFor(context.getFilename(), spec)) {
    context.report({ node, message: message(f) });
  }
}

module.exports = {
  rules: {
    boundaries: {
      meta: {
        type: 'problem',
        docs: { description: 'Публичный вход очищенных доменов и запрет платформе тянуть бизнес' },
        schema: [],
      },
      create(context) {
        const onSource = (node) => {
          if (node && node.source) checkSource(context, node.source, node.source.value);
        };
        return {
          ImportDeclaration: onSource,
          ExportAllDeclaration: onSource,
          ExportNamedDeclaration: onSource,
          ImportExpression(node) {
            if (node.source && node.source.type === 'Literal') checkSource(context, node.source, node.source.value);
          },
        };
      },
    },
  },
};
