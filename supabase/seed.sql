insert into communities (id, name, city)
values ('11111111-1111-1111-1111-111111111111', 'Среди Своих', 'Москва')
on conflict do nothing;
