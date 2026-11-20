-- Rodar UMA vez no SQL Editor do Supabase, depois de criar o usuário em
-- Authentication > Users. Troque o e-mail pelo do usuário criado.
-- Sem esta linha, o login funciona mas nenhuma tabela responde (RLS do dono).

insert into manhua.dono (user_id)
select id from auth.users where email = 'SEU_EMAIL_AQUI'
on conflict do nothing;

-- Conferência: tem que devolver exatamente 1 linha.
select d.user_id, u.email
  from manhua.dono d
  join auth.users u on u.id = d.user_id;
