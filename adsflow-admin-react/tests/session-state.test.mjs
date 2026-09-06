import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/auth/sessionState.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { needsRegistration } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
test('only explicit authenticated missing-user state enters registration', () => {
  assert.equal(needsRegistration({status:403,code:'registration_required'}),true);
  for (const error of [null,undefined,new TypeError('fetch failed'),{status:403,code:'user_disabled'},{status:403,code:'user_not_enabled'},{status:401,code:'unauthenticated'},{status:503,code:'registration_required'},{code:'registration_required'},{status:502,code:'invalid_api_response'}]) assert.equal(needsRegistration(error),false);
});
