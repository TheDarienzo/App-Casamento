-- Versão mínima do app que ainda pode gravar. Versões abaixo recebem 426
-- e só leem: a v29 (e anteriores) mandava o cadastro inteiro ao abrir e
-- sobrescrevia o que o outro celular tinha alterado.
insert into configuracao (chave, valor) values ('versao_minima_gravacao', '30')
on conflict (chave) do update set valor = excluded.valor;
