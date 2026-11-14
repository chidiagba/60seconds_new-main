// Syntax and security lint for production TS, including Deno entrypoints.
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let failures = 0;
function report(file, message) { console.error(`${file}: ${message}`); failures++; }
function visit(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    const file = path.join(dir,entry.name);
    if (entry.isDirectory()) visit(file);
    else if (/\.tsx?$/.test(file)) {
      const source = ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
      for (const error of source.parseDiagnostics) report(file,ts.flattenDiagnosticMessageText(error.messageText,' '));
      if (!file.endsWith('.d.ts')) {
        try {
          const compiled = ts.transpileModule(source.text, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
          new vm.Script(compiled, { filename: file });
        } catch (error) { report(file, error.message); }
      }
      const client = /^(app|components|hooks|lib|utils|store)\//.test(file);
      function check(node) {
        if (client && file !== 'lib/logger.ts' && ts.isCallExpression(node) && /^console\.(log|info|debug|warn|error)$/.test(node.expression.getText(source))) report(file,'Use the production-silent logger');
        if (client && ts.isPropertyAccessExpression(node) && node.expression.getText(source)==='process.env' && /SERVICE_ROLE|SECRET_KEY|WEBHOOK_SECRET/.test(node.name.text)) report(file,'Server secrets must not be referenced in client source');
        if (ts.isCallExpression(node) && node.expression.getText(source)==='eval') report(file,'Dynamic eval is forbidden');
        ts.forEachChild(node, check);
      }
      check(source);
    }
  }
}
['app','components','hooks','lib','utils','store','backend','supabase/functions'].forEach(visit);
process.exitCode = failures ? 1 : 0;
