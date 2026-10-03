import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBrazilianMobilePhone as format, parseBrazilianMobilePhone as parse,
  isValidBrazilianMobilePhone as valid } from "../../lib/brazilian-mobile-phone.ts";

test("celular opcional, máscara progressiva e normalização E.164", () => {
  assert.equal(valid(""), true);
  assert.equal(parse(" "), null);
  assert.equal(format(""), "");
  assert.equal(format("1"), "(1");
  assert.equal(format("119"), "(11) 9");
  assert.equal(format("11912345"), "(11) 91234-5");
  assert.equal(format("11912345678"), "(11) 91234-5678");
  assert.equal(format("+5511912345678"), "(11) 91234-5678");
  assert.equal(parse("(11) 91234-5678"), "+5511912345678");
  assert.equal(parse("+5511912345678"), "+5511912345678");
});

test("rejeita telefone incompleto, fixo, excesso de dígitos e DDD iniciado em zero", () => {
  for (const value of ["1191234567", "11812345678", "119123456789", "01912345678", "11", "abc11912345678", "+11912345678"]) {
    assert.equal(valid(value), false);
    assert.throws(() => parse(value));
  }
});
